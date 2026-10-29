import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = (path) =>
  ts.transpile(readFileSync(new URL(path, import.meta.url), "utf8"), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  });
const moduleUrl = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const pitchUrl = moduleUrl(compile("../src/lib/pitch.ts"));
const {
  smooth,
  singerContour,
  connects,
  pitchWindowStart,
  LiveFilter,
  wav,
  comparison,
} = await import(pitchUrl);
const { defaults } = await import(moduleUrl(compile("../src/lib/types.ts")));

test("reference smoothing removes a single-frame spike, preserves a sustained slide, and never edits raw data", () => {
  const points = [60, 60, 72, 60, 60, null, 62, 62.5, 63, 63.5, 64].map(
    (midi, i) => ({ t: i * 0.01, midi, conf: 0.9, rms: 0.1 }),
  );
  const saved = JSON.stringify(points);
  const result = smooth(points, 50, 0.12);
  assert.equal(result[2].midi, 60);
  assert.equal(result[5].midi, null);
  assert.ok(result[9].midi > result[6].midi);
  assert.equal(JSON.stringify(points), saved);
  assert.deepEqual(smooth(points, 0), points);
});
test("silent stem guesses are hidden only in the processed view", () => {
  const raw = [{ t: 0, midi: 70, conf: 0.6, rms: 0.00001 }];
  assert.equal(smooth(raw, 50, 0.12, -62)[0].midi, null);
  assert.equal(raw[0].midi, 70);
});
test("singer cleanup rejects quiet bleed but retains soft phrases, short ornaments and raw estimates", () => {
  const points = Array.from({ length: 100 }, (_, i) => ({
    t: i * 0.01,
    midi: i < 30 ? 83 : 60 + Math.sin(i / 4),
    conf: 0.9,
    rms: i < 30 ? 0.0008 : i < 60 ? 0.01 : 0.1,
  }));
  const saved = JSON.stringify(points);
  const result = singerContour(points, defaults);
  assert.ok(result.slice(0, 30).every((p) => p.midi === null));
  assert.ok(result.slice(30).every((p) => p.midi !== null));
  const ornament = Array.from({ length: 5 }, (_, i) => ({
    t: 2 + i * 0.01,
    midi: 72,
    conf: 0.9,
    rms: 0.1,
  }));
  const quietIsland = ornament.map((p) => ({ ...p, t: p.t + 1, rms: 0.003 }));
  const combined = singerContour(
    [...points, ...ornament, ...quietIsland],
    defaults,
  );
  assert.ok(combined.slice(100, 105).every((p) => p.midi !== null));
  assert.ok(combined.slice(105).every((p) => p.midi === null));
  assert.deepEqual(
    singerContour(points, { ...defaults, referenceCleanup: false }),
    smooth(points, 50, 0.12, -62),
  );
  assert.equal(JSON.stringify(points), saved);
});
test("discontinuous pitch estimates never become vertical slides; genuine notes and glides remain", () => {
  const p = (t, midi) => ({ t, midi, conf: 0.9 });
  assert.equal(connects(p(0, 50), p(0.01, 83)), false);
  assert.equal(connects(p(0, 60), p(0.01, 72)), false);
  assert.equal(connects(p(0.01, 72), p(0.02, 72)), true);
  assert.equal(connects(p(0, 60), p(0.01, 61)), true);
  assert.equal(connects(p(0, 60), p(0.2, 60)), false);
  assert.equal(connects(p(0, null), p(0.01, 60)), false);
});
test("pitch playback and seek share a left-aligned window at every zoom", () => {
  for (const span of [6, 12, 24]) {
    assert.equal(pitchWindowStart(0, span), 0);
    const left = pitchWindowStart(40, span);
    const fraction = (40 - left) / span;
    assert.ok(fraction > 0 && fraction <= 0.050001);
    assert.equal(left + fraction * span, 40);
    assert.ok(left + span > 40);
  }
});
test("quiet live voice is accepted, noise rejected, and confirmed octave changes eventually appear", () => {
  const f = new LiveFilter();
  const point = (midi = 57, rms = 0.004, conf = 0.95) => ({
    t: 0,
    midi,
    rms,
    conf,
  });
  assert.equal(f.process(point(), defaults).midi, 57);
  assert.equal(f.process(point(57, 0.0001), defaults).midi, null);
  assert.equal(f.process(point(69), defaults).midi, null);
  assert.equal(f.process(point(69), defaults).midi, null);
  assert.equal(f.process(point(69), defaults).midi, 69);
  assert.equal(
    f.process(point(57), { ...defaults, stability: false, liveSmooth: 0 }).midi,
    57,
  );
});
test("WAV contains the original sample count, sample rate and amplitude", async () => {
  const input = Float32Array.from(
    { length: 4800 },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / 48000),
  );
  const blob = wav([input], 48000);
  const v = new DataView(await blob.arrayBuffer());
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 9600);
  for (let i = 0; i < input.length; i += 151)
    assert.ok(
      Math.abs(v.getInt16(44 + i * 2, true) / 32768 - input[i]) < 0.00005,
    );
});
test("take comparison uses the saved recording start instead of assuming time zero", () => {
  const reference = [
    { t: 5, midi: 60, conf: 0.9 },
    { t: 5.01, midi: 61, conf: 0.9 },
  ];
  const take = [
    { t: 0, midi: 60.25, conf: 0.9 },
    { t: 0.01, midi: 61.25, conf: 0.9 },
  ];
  assert.equal(comparison(reference, take, 5).cents, 25);
  assert.equal(comparison(reference, take, 0), null);
});
test("worklet captures exactly the scheduled frames without monitor gain or filters", () => {
  let Capture;
  const messages = [];
  const context = {
    Float32Array,
    Infinity,
    Math,
    sampleRate: 48000,
    currentFrame: 0,
    registerProcessor: (_, c) => (Capture = c),
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m) };
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(
      new URL("../public/capture-worklet.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const processor = new Capture();
  processor.port.onmessage({ data: { kind: "start", time: 128 / 48000 } });
  processor.port.onmessage({ data: { kind: "stop", time: 512 / 48000 } });
  for (let i = 0; i < 6; i++) {
    context.currentFrame = i * 128;
    processor.process([[new Float32Array(128).fill(0.125)]]);
  }
  const audio = messages.filter((m) => m.kind === "audio");
  assert.equal(
    audio.reduce((n, m) => n + m.samples.length, 0),
    384,
  );
  assert.ok(audio.every((m) => m.samples.every((s) => s === 0.125)));
  assert.equal(messages.filter((m) => m.kind === "done").length, 1);
});
test("multitrack transport schedules every source against one clock and seeks without losing offsets", async () => {
  const sources = [];
  class Gain {
    gain = {
      value: 1,
      setTargetAtTime(v) {
        this.value = v;
      },
    };
    connect() {}
    disconnect() {}
  }
  class Context {
    currentTime = 10;
    destination = {};
    createGain() {
      return new Gain();
    }
    createBufferSource() {
      const s = {
        buffer: null,
        connect(g) {
          this.gain = g;
        },
        disconnect() {},
        start(...args) {
          this.started = args;
        },
        stop() {},
      };
      sources.push(s);
      return s;
    }
    async resume() {}
    async close() {}
    async decodeAudioData() {
      return { duration: 10 };
    }
  }
  globalThis.AudioContext = Context;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  try {
    const code = compile("../src/lib/engine.ts")
      .replace(
        /from ["']pitchy["']/,
        `from ${JSON.stringify(moduleUrl("export const PitchDetector={forFloat32Array:()=>({})}"))}`,
      )
      .replace(/from ["']\.\/pitch["']/, `from ${JSON.stringify(pitchUrl)}`)
      .replace(
        /from ["']\.\/types["']/,
        `from ${JSON.stringify(moduleUrl(compile("../src/lib/types.ts")))}`,
      );
    const { StudioEngine } = await import(moduleUrl(code));
    const e = new StudioEngine();
    const tracks = [
      {
        id: "singer",
        start: 0,
        duration: 10,
        volume: 1,
        muted: false,
        solo: false,
      },
      {
        id: "take",
        start: 5,
        duration: 5,
        volume: 0.5,
        muted: false,
        solo: false,
      },
    ];
    await e.load("project", tracks);
    await e.play(2, 11);
    assert.deepEqual(sources[0].started, [11, 2]);
    assert.deepEqual(sources[1].started, [14, 0]);
    e.mix([{ ...tracks[0], solo: true }, tracks[1]]);
    assert.equal(sources[1].gain.gain.value, 0);
    e.ctx.currentTime = 12;
    e.pause();
    assert.equal(e.position, 3);
    await e.seek(6);
    await e.play();
    assert.equal(sources.at(-1).started[1], 1);
    await e.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});
