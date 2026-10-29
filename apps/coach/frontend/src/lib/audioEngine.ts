import { StemName, STEM_NAMES, MixState } from "@/types";

export interface AudioEngine {
  context: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
  stems: Record<
    StemName,
    {
      buffer: AudioBuffer | null;
      source: AudioBufferSourceNode | null;
      gain: GainNode;
      pan: StereoPannerNode;
    }
  >;
  isPlaying: boolean;
  startTime: number;
  pauseOffset: number;
  duration: number;
}

export function createEngine(): AudioEngine {
  const context = new AudioContext();
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;

  masterGain.connect(analyser);
  analyser.connect(context.destination);

  const stems = {} as AudioEngine["stems"];
  for (const name of STEM_NAMES) {
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    gain.connect(pan);
    pan.connect(masterGain);
    stems[name] = { buffer: null, source: null, gain, pan };
  }

  return {
    context,
    masterGain,
    analyser,
    stems,
    isPlaying: false,
    startTime: 0,
    pauseOffset: 0,
    duration: 0,
  };
}

export async function loadStem(
  engine: AudioEngine,
  name: StemName,
  url: string
): Promise<void> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await engine.context.decodeAudioData(arrayBuffer);
  engine.stems[name].buffer = audioBuffer;
  engine.duration = Math.max(engine.duration, audioBuffer.duration);
}

export function play(engine: AudioEngine): void {
  if (engine.isPlaying) return;

  for (const name of STEM_NAMES) {
    const stem = engine.stems[name];
    if (!stem.buffer) continue;

    const source = engine.context.createBufferSource();
    source.buffer = stem.buffer;
    source.connect(stem.gain);
    stem.source = source;
    source.start(0, engine.pauseOffset);
  }

  engine.startTime = engine.context.currentTime - engine.pauseOffset;
  engine.isPlaying = true;
}

export function pause(engine: AudioEngine): void {
  if (!engine.isPlaying) return;

  engine.pauseOffset = engine.context.currentTime - engine.startTime;

  for (const name of STEM_NAMES) {
    const stem = engine.stems[name];
    if (stem.source) {
      stem.source.stop();
      stem.source = null;
    }
  }

  engine.isPlaying = false;
}

export function stop(engine: AudioEngine): void {
  pause(engine);
  engine.pauseOffset = 0;
}

export function seek(engine: AudioEngine, time: number): void {
  const wasPlaying = engine.isPlaying;
  if (wasPlaying) pause(engine);
  engine.pauseOffset = Math.max(0, Math.min(time, engine.duration));
  if (wasPlaying) play(engine);
}

export function getCurrentTime(engine: AudioEngine): number {
  if (engine.isPlaying) {
    return engine.context.currentTime - engine.startTime;
  }
  return engine.pauseOffset;
}

export function setGain(engine: AudioEngine, stem: StemName, value: number): void {
  engine.stems[stem].gain.gain.value = value;
}

export function setPan(engine: AudioEngine, stem: StemName, value: number): void {
  engine.stems[stem].pan.pan.value = value;
}

export function applyMixState(engine: AudioEngine, mixState: MixState): void {
  const anySolo = STEM_NAMES.some((n) => mixState[n].solo);

  for (const name of STEM_NAMES) {
    const state = mixState[name];
    const stem = engine.stems[name];

    // If any stem is soloed, mute all non-soloed stems
    const effectiveMute = state.mute || (anySolo && !state.solo);
    stem.gain.gain.value = effectiveMute ? 0 : state.gain;
    stem.pan.pan.value = state.pan;
  }
}

export function setMasterGain(engine: AudioEngine, value: number): void {
  engine.masterGain.gain.value = value;
}

export function destroyEngine(engine: AudioEngine): void {
  stop(engine);
  engine.context.close();
}
