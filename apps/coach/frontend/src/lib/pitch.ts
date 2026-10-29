import { PitchDetector } from "pitchy";

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export const A4 = 440;

/** Fractional MIDI from frequency (Hz). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / A4);
}

export function midiToHz(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

// --- Hindustani sargam (Bhatkhande notation) ---
// Pitch classes map to swaras with C = Sa. Komal (flat) swaras are lowercase
// in Latin and carry an anudatta (॒) below in Devanagari; tivra Ma carries an
// udatta (॑) above. Octave is relative to madhya saptak (C4–B4 = octave 0).
const SWARA_DEV = ["सा", "रे॒", "रे", "ग॒", "ग", "म", "म॑", "प", "ध॒", "ध", "नि॒", "नि"];
const SWARA_LAT = ["Sa", "re", "Re", "ga", "Ga", "Ma", "Ma'", "Pa", "dha", "Dha", "ni", "Ni"];

export interface Swara {
  pc: number; // pitch class 0..11
  dev: string; // Devanagari glyph (with komal/tivra marks)
  lat: string; // Latin (lowercase = komal, ' = tivra)
  octave: number; // 0 = madhya, -1 mandra, +1 taar, ...
  komal: boolean;
  tivra: boolean;
}

export function midiToSwara(midi: number): Swara {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  return {
    pc,
    dev: SWARA_DEV[pc],
    lat: SWARA_LAT[pc],
    octave: Math.floor(m / 12) - 5, // C4 (MIDI 60) -> 0
    komal: [1, 3, 8, 10].includes(pc),
    tivra: pc === 6,
  };
}

/** Warm in-tune → off-pitch colour: saffron gold (0¢) drifting to vermillion. */
export function centsColor(cents: number): string {
  const c = Math.min(Math.abs(cents), 50) / 50; // 0..1
  const hue = 42 - c * 34; // 42 gold -> 8 vermillion
  const sat = 82 + c * 10;
  const light = 62 - c * 10;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** How far (in cents, -50..+50) a frequency sits from the nearest semitone. */
export function centsOffset(hz: number): number {
  const midi = hzToMidi(hz);
  return (midi - Math.round(midi)) * 100;
}

export interface PitchSample {
  time: number; // seconds since detector start
  hz: number | null; // null = unvoiced / rejected
  clarity: number;
  midi: number | null;
  rms?: number;
}

export interface LiveDetectorOptions {
  /** MPM clarity floor — below this we treat the frame as noise. */
  minClarity?: number;
  /** RMS energy gate — below this we treat the frame as silence. */
  minRms?: number;
  /** Trusted vocal range. */
  minHz?: number;
  maxHz?: number;
  gain?: number;
  smoothingFrames?: number;
  deviceId?: string;
  onSample: (s: PitchSample) => void;
}

const ANALYSIS_INTERVAL_MS = 33;
const ATTACK_FRAMES = 2;
const RELEASE_FRAMES = 3;
const SMOOTHING_FRAMES = 5;
const LARGE_JUMP_SEMITONES = 7;
const JUMP_CONFIRM_FRAMES = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Live, low-latency pitch tracker.
 *
 * Captures the mic, runs pitchy's MPM (McLeod Pitch Method) at a stable 30Hz,
 * and emits a gated, median-smoothed f0 sample. Noise rejection combines an
 * RMS gate, MPM clarity, a vocal-range clamp, attack/release hysteresis, and
 * a short confirmation window for large jumps. This keeps breaths, consonants,
 * and one-frame octave errors from turning into distracting notes.
 *
 * It also tees the mic into a MediaRecorder so the raw clip can be sent to the
 * backend for the accurate pYIN pass when the user stops.
 */
export class LiveDetector {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private detector?: PitchDetector<Float32Array<ArrayBuffer>>;
  private buf?: Float32Array<ArrayBuffer>;
  private raf = 0;
  private startTime = 0;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private lastAnalysisAt = 0;
  private voicedFrames = 0;
  private unvoicedFrames = 0;
  private recentMidi: number[] = [];
  private lastStableMidi: number | null = null;
  private isVoiced = false;
  private pendingJumpMidi: number | null = null;
  private pendingJumpFrames = 0;
  private inputGain?: GainNode;
  private rms = 0;

  private readonly opts: Required<Omit<LiveDetectorOptions, "onSample">> & {
    onSample: (s: PitchSample) => void;
  };

  constructor(options: LiveDetectorOptions) {
    this.opts = {
      // Low voices carry less harmonic definition at the fundamental than
      // higher voices. Keep this permissive and let the stability gates below
      // reject room noise rather than throwing away valid bass/baritone notes.
      minClarity: options.minClarity ?? 0.78,
      minRms: options.minRms ?? 0.006,
      minHz: options.minHz ?? 55,
      maxHz: options.maxHz ?? 1500,
      gain: options.gain ?? 1,
      smoothingFrames: options.smoothingFrames ?? SMOOTHING_FRAMES,
      deviceId: options.deviceId ?? "",
      onSample: options.onSample,
    };
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(this.opts.deviceId ? { deviceId: { exact: this.opts.deviceId } } : {}),
          // For a singing app we want the *true* pitch, so disable the
          // processing that can distort it. We gate noise ourselves.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.ctx = new AudioContext();
      await this.ctx.resume();
      const source = this.ctx.createMediaStreamSource(this.stream);

      // Keep the detector focused on the fundamental vocal band: rumble and
      // plosives below it, and hiss above it, otherwise confuse MPM.
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      // Do not cut into bass/baritone fundamentals. 35Hz still removes most
      // handling rumble while preserving an A1 (55Hz) and the lower partials
      // that make pitch detection reliable for low voices.
      hp.frequency.value = 35;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;

      this.inputGain = this.ctx.createGain();
      this.inputGain.gain.value = this.opts.gain;
      source.connect(this.inputGain);
      this.inputGain.connect(hp);
      hp.connect(lp);
      lp.connect(this.analyser);

      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);

      // Tee raw mic to a recorder for the accurate backend pass.
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream);
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start();

      this.lastAnalysisAt = 0;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.recentMidi = [];
      this.lastStableMidi = null;
      this.isVoiced = false;
      this.pendingJumpMidi = null;
      this.pendingJumpFrames = 0;
      this.startTime = this.ctx.currentTime;
      this.loop();
    } catch (error) {
      this.stream?.getTracks().forEach((track) => track.stop());
      await this.ctx?.close();
      this.stream = undefined;
      this.ctx = undefined;
      throw error;
    }
  }

  private loop = () => {
    if (!this.analyser || !this.detector || !this.buf || !this.ctx) return;
    const now = this.ctx.currentTime;
    if ((now - this.lastAnalysisAt) * 1000 < ANALYSIS_INTERVAL_MS) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.lastAnalysisAt = now;
    this.analyser.getFloatTimeDomainData(this.buf);

    let sumSq = 0;
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sumSq / this.buf.length);
    this.rms = rms;

    const time = now - this.startTime;
    let candidateMidi: number | null = null;
    let clarity = 0;

    if (rms >= this.opts.minRms) {
      const [pitch, clr] = this.detector.findPitch(this.buf, this.ctx.sampleRate);
      clarity = clr;
      if (clr >= this.opts.minClarity && pitch >= this.opts.minHz && pitch <= this.opts.maxHz) {
        candidateMidi = hzToMidi(pitch);
      }
    }

    this.emitStabilizedSample(time, candidateMidi, clarity);

    this.raf = requestAnimationFrame(this.loop);
  };

  private emitStabilizedSample(time: number, candidateMidi: number | null, clarity: number) {
    if (candidateMidi === null) {
      this.unvoicedFrames += 1;
      this.voicedFrames = 0;
      this.pendingJumpMidi = null;
      this.pendingJumpFrames = 0;
      if (this.unvoicedFrames >= RELEASE_FRAMES) {
        this.recentMidi = [];
        this.lastStableMidi = null;
        this.isVoiced = false;
      }
      // Do not paint invented pitch through silence or low-confidence frames.
      this.opts.onSample({ time, hz: null, clarity, midi: null, rms: this.rms });
      return;
    }

    this.unvoicedFrames = 0;
    this.voicedFrames += 1;

    // A genuine interval can be large, but it should persist. Holding the
    // existing note for two frames filters the common one-frame octave flip.
    if (
      this.isVoiced && this.lastStableMidi !== null &&
      Math.abs(candidateMidi - this.lastStableMidi) >= LARGE_JUMP_SEMITONES
    ) {
      if (this.pendingJumpMidi !== null && Math.abs(candidateMidi - this.pendingJumpMidi) < 0.75) {
        this.pendingJumpFrames += 1;
      } else {
        this.pendingJumpMidi = candidateMidi;
        this.pendingJumpFrames = 1;
      }
      if (this.pendingJumpFrames < JUMP_CONFIRM_FRAMES) {
        this.emitVoiced(time, this.lastStableMidi, clarity);
        return;
      }
      this.recentMidi = [];
      this.pendingJumpMidi = null;
      this.pendingJumpFrames = 0;
    } else {
      this.pendingJumpMidi = null;
      this.pendingJumpFrames = 0;
    }

    this.recentMidi.push(candidateMidi);
    while (this.recentMidi.length > this.opts.smoothingFrames) this.recentMidi.shift();
    const stableMidi = median(this.recentMidi);
    this.lastStableMidi = stableMidi;

    if (this.voicedFrames >= ATTACK_FRAMES) {
      this.emitVoiced(time, stableMidi, clarity);
    } else {
      this.opts.onSample({ time, hz: null, clarity, midi: null, rms: this.rms });
    }
  }

  private emitVoiced(time: number, midi: number, clarity: number) {
    this.isVoiced = true;
    this.opts.onSample({ time, hz: midiToHz(midi), clarity, midi, rms: this.rms });
  }

  /** Apply tuning without reopening the microphone or interrupting playback. */
  configure(options: Partial<Omit<LiveDetectorOptions, "onSample" | "deviceId">>): void {
    Object.assign(this.opts, options);
    if (this.inputGain && this.ctx) this.inputGain.gain.setTargetAtTime(this.opts.gain, this.ctx.currentTime, 0.02);
  }

  setRecordingPaused(paused: boolean): void {
    if (paused && this.recorder?.state === "recording") this.recorder.pause();
    if (!paused && this.recorder?.state === "paused") this.recorder.resume();
  }

  /** Stop everything and resolve with the recorded clip (for backend analysis). */
  async stop(): Promise<Blob | null> {
    cancelAnimationFrame(this.raf);
    const clip = await this.finishRecording();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.stream = undefined;
    this.ctx = undefined;
    this.analyser = undefined;
    this.detector = undefined;
    this.buf = undefined;
    return clip;
  }

  private finishRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        resolve(this.chunks.length ? new Blob(this.chunks, { type: this.recorder!.mimeType }) : null);
      };
      this.recorder.stop();
    });
  }
}
