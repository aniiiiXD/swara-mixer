import { PitchDetector } from "pitchy";
import { midi, wav } from "./pitch";
import { audioUrl, type Point, type Track } from "./types";
/** All tracks are scheduled on one AudioContext clock, including mic capture. */
export class StudioEngine {
  ctx: AudioContext;
  master: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  private loadGeneration = 0;
  tracks: Track[] = [];
  playing = false;
  position = 0;
  epoch = 0;
  duration = 0;
  private stream?: MediaStream;
  private mic?: AudioWorkletNode;
  private input?: MediaStreamAudioSourceNode;
  private mutedOutput?: GainNode;
  private chunks: Float32Array[] = [];
  private detector = PitchDetector.forFloat32Array(4096);
  private window = new Float32Array(4096);
  private stopping?: (value: Blob) => void;
  onMicEnded?: () => void;
  onPitch?: (p: Point) => void;
  onEnded?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
  }
  async load(pid: string, tracks: Track[]) {
    const generation = ++this.loadGeneration;
    const missing = tracks.filter((t) => !this.buffers.has(t.id));
    await Promise.all(
      missing.map(async (t) => {
        const r = await fetch(audioUrl(pid, t.id));
        if (!r.ok) throw Error(`Could not load ${t.name}`);
        this.buffers.set(
          t.id,
          await this.ctx.decodeAudioData(await r.arrayBuffer()),
        );
      }),
    );
    if (generation !== this.loadGeneration) return;
    this.tracks = tracks;
    this.duration = Math.max(0, ...tracks.map((t) => t.start + t.duration));
    this.mix(tracks);
  }
  time() {
    return this.playing
      ? Math.min(
          this.duration,
          this.position + Math.max(0, this.ctx.currentTime - this.epoch),
        )
      : this.position;
  }
  async play(position = this.position, startAt?: number) {
    await this.ctx.resume();
    this.halt();
    this.position = Math.max(0, Math.min(position, this.duration));
    this.epoch = startAt ?? this.ctx.currentTime + 0.06;
    this.playing = true;
    for (const t of this.tracks) {
      const buffer = this.buffers.get(t.id);
      if (!buffer) continue;
      const offset = Math.max(0, this.position - t.start);
      if (offset >= buffer.duration) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      source.connect(gain);
      gain.connect(this.master);
      this.gains.set(t.id, gain);
      source.start(this.epoch + Math.max(0, t.start - this.position), offset);
      this.sources.push(source);
    }
    this.mix(this.tracks);
    this.timer = setInterval(() => {
      if (this.time() >= this.duration) {
        this.pause();
        this.onEnded?.();
      }
    }, 40);
  }
  private halt() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    this.sources = [];
    for (const g of this.gains.values()) g.disconnect();
    this.gains.clear();
    clearInterval(this.timer);
  }
  pause() {
    this.position = this.time();
    this.playing = false;
    this.halt();
  }
  async seek(t: number) {
    const was = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.duration, t));
    if (was) await this.play();
  }
  mix(tracks: Track[]) {
    this.tracks = tracks;
    const solo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      const g = this.gains.get(t.id);
      if (g)
        g.gain.setTargetAtTime(
          t.muted || (solo && !t.solo) ? 0 : t.volume,
          this.ctx.currentTime,
          0.015,
        );
    }
  }
  volume(value: number) {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }
  async enableMic(device: string) {
    await this.disableMic();
    await this.ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: device ? { exact: device } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    try {
      await this.ctx.audioWorklet.addModule("/capture-worklet.js");
      this.stream = stream;
      stream
        .getAudioTracks()
        .forEach((t) => t.addEventListener("ended", () => this.onMicEnded?.()));
      this.input = this.ctx.createMediaStreamSource(stream);
      this.mic = new AudioWorkletNode(this.ctx, "tonic-capture");
      this.mutedOutput = this.ctx.createGain();
      this.mutedOutput.gain.value = 0;
      this.input.connect(this.mic);
      this.mic.connect(this.mutedOutput);
      this.mutedOutput.connect(this.ctx.destination);
      this.mic.port.onmessage = (e) => {
        const data = e.data;
        if (data.kind === "audio") this.chunks.push(data.samples);
        if (data.kind === "done") {
          this.stopping?.(wav(this.chunks, this.ctx.sampleRate));
          this.stopping = undefined;
          this.chunks = [];
        }
        if (data.kind === "pitch") {
          const samples = data.samples as Float32Array;
          this.window.copyWithin(0, samples.length);
          this.window.set(samples, this.window.length - samples.length);
          let sum = 0;
          for (const v of this.window) sum += v * v;
          const rms = Math.sqrt(sum / this.window.length);
          const [f, conf] = this.detector.findPitch(
            this.window,
            this.ctx.sampleRate,
          );
          this.onPitch?.({
            t: data.time - this.window.length / (2 * this.ctx.sampleRate),
            midi: Number.isFinite(f) && f > 0 ? midi(f) : null,
            conf,
            rms,
          });
        }
      };
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }
  async disableMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.input?.disconnect();
    this.mic?.disconnect();
    this.mutedOutput?.disconnect();
    this.mic = undefined;
    this.stream = undefined;
  }
  async record(start: number) {
    if (!this.mic) throw Error("Enable a microphone first");
    await this.ctx.resume();
    this.chunks = [];
    const epoch = this.ctx.currentTime + 0.12;
    this.mic.port.postMessage({ kind: "start", time: epoch });
    await this.play(start, epoch);
    return epoch;
  }
  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mic) return reject(Error("Microphone disconnected"));
      const timeout = setTimeout(() => {
        this.stopping = undefined;
        resolve(wav(this.chunks, this.ctx.sampleRate));
        this.chunks = [];
      }, 1500);
      this.stopping = (blob) => {
        clearTimeout(timeout);
        resolve(blob);
      };
      this.mic.port.postMessage({ kind: "stop", time: this.ctx.currentTime });
    });
  }
  async close() {
    this.pause();
    await this.disableMic();
    await this.ctx.close();
  }
}
