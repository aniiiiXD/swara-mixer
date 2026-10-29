// Web Audio helpers: a sustained tanpura-style drone, target-phrase playback,
// and a simple metronome.

export const degHz = (saHz: number, deg: number) => saHz * Math.pow(2, deg / 12);

/** Sustained drone on the tonic: low Sa, Pa (5th), Sa, with gentle shimmer. */
export class Drone {
  private ctx?: AudioContext;
  private nodes: OscillatorNode[] = [];
  private gain?: GainNode;

  start(saHz: number) {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.gain = master;

    // Sa (low), Pa, Sa — the core tanpura tones
    const freqs = [saHz / 2, degHz(saHz, 7) / 2, saHz];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      osc.connect(g);
      g.connect(lp);
      lp.connect(master);
      osc.start();
      this.nodes.push(osc);
    }
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.4);
  }

  stop() {
    if (this.ctx && this.gain) {
      this.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
      const ctx = this.ctx;
      this.nodes.forEach((o) => o.stop(ctx.currentTime + 0.3));
      setTimeout(() => ctx.close().catch(() => {}), 400);
    }
    this.nodes = [];
    this.ctx = undefined;
    this.gain = undefined;
  }
}

/** Play a target phrase so the learner can hear it. Returns when finished. */
export function playSequence(
  target: { deg: number; beats: number }[],
  saHz: number,
  bpm: number,
): Promise<void> {
  const ctx = new AudioContext();
  const beat = 60 / bpm;
  let t = ctx.currentTime + 0.1;
  let end = t;
  for (const n of target) {
    const dur = n.beats * beat;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = degHz(saHz, n.deg);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.03);
    g.gain.setValueAtTime(0.25, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
    end = t;
  }
  return new Promise((resolve) =>
    setTimeout(() => {
      ctx.close().catch(() => {});
      resolve();
    }, (end - ctx.currentTime) * 1000 + 200),
  );
}
