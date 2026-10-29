import type { Point, Settings } from "./types";
export const midi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const swaras = [
  "Sa",
  "re",
  "Re",
  "ga",
  "Ga",
  "Ma",
  "Ma♯",
  "Pa",
  "dha",
  "Dha",
  "ni",
  "Ni",
];
export const name = (m: number) =>
  `${names[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;
export const label = (m: number, s: Settings) =>
  s.notation === "notes"
    ? name(m)
    : `${swaras[(((m - s.tonic) % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
export const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** Keep a little recent history, with the upcoming phrase to the right. */
export const pitchWindowStart = (time: number, span: number) =>
  Math.max(0, time - Math.min(0.6, span * 0.05));

/** Separate discontinuous estimates instead of inventing a vertical slide. */
export function connects(a: Point | null, b: Point): boolean {
  if (!a || a.midi === null || b.midi === null) return false;
  const dt = b.t - a.t;
  return (
    dt > 0 && dt <= 0.15 && Math.abs(b.midi - a.midi) <= Math.max(3, dt * 60)
  );
}

/** Optional stem-bleed rejection, relative to this recording's own vocal level.
 * Does not quantize notes, correct octaves, bridge gaps, or modify raw estimates.
 */
export function singerContour(points: Point[], s: Settings): Point[] {
  const levels = points
    .filter((p) => p.midi !== null && p.conf >= 0.5 && (p.rms ?? 0) > 0)
    .map((p) => p.rms!)
    .sort((a, b) => a - b);
  const typical = levels[Math.floor(levels.length * 0.9)];
  const adaptive =
    s.referenceCleanup && typical ? 20 * Math.log10(typical) - 36 : -120;
  const result = smooth(
    points,
    s.referenceSmooth,
    s.referenceGate,
    Math.max(s.referenceSilence, adaptive),
  );
  if (!s.referenceCleanup || !typical) return result;
  // Brief, very quiet islands are usually accompaniment leaking into the stem.
  // Keep short ornaments at normal vocal level and sustained quiet singing.
  let start = 0;
  const finish = (end: number) => {
    if (end <= start) return;
    if (
      result[end - 1].t - result[start].t < 0.12 &&
      result
        .slice(start, end)
        .every((p) => p.rms !== undefined && p.rms < typical * 10 ** (-24 / 20))
    ) {
      for (let j = start; j < end; j++)
        result[j] = { ...result[j], midi: null };
    }
  };
  for (let i = 0; i < result.length; i++) {
    if (
      result[i].midi === null ||
      (i > start && !connects(result[i - 1], result[i]))
    ) {
      finish(i);
      start = result[i].midi === null ? i + 1 : i;
    }
  }
  finish(result.length);
  return result;
}
/** Independent, reversible display processing; raw input is never mutated. */
export function smooth(
  points: Point[],
  milliseconds: number,
  gate = 0,
  silenceDb = -120,
): Point[] {
  const half = milliseconds / 2000;
  return points.map((p, i) => {
    if (
      p.midi === null ||
      p.conf < gate ||
      (p.rms !== undefined && p.rms < 10 ** (silenceDb / 20))
    )
      return { ...p, midi: null };
    if (!half) return { ...p };
    const values: number[] = [p.midi];
    for (const dir of [-1, 1])
      for (let j = i + dir; j >= 0 && j < points.length; j += dir) {
        const q = points[j];
        if (
          Math.abs(q.t - p.t) > half ||
          q.midi === null ||
          q.conf < gate ||
          (q.rms !== undefined && q.rms < 10 ** (silenceDb / 20))
        )
          break;
        values.push(q.midi);
      }
    return { ...p, midi: median(values) };
  });
}
export function at(points: Point[], t: number): Point | null {
  let lo = 0,
    hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = points[lo],
    b = points[lo - 1];
  const p = !a ? b : !b ? a : Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
  return p && Math.abs(p.t - t) < 0.08 ? p : null;
}
export function comparison(reference: Point[], take: Point[], offset: number) {
  const differences: number[] = [];
  for (const p of take) {
    if (p.midi === null || p.conf < 0.5) continue;
    const r = at(reference, p.t + offset);
    if (r?.midi != null && r.conf >= 0.2)
      differences.push((p.midi - r.midi) * 100);
  }
  return differences.length
    ? {
        cents: Math.round(median(differences)),
        within: Math.round(
          (differences.filter((x) => Math.abs(x) <= 50).length /
            differences.length) *
            100,
        ),
        frames: differences.length,
      }
    : null;
}
/** Live constraints are separate from recorded raw estimates and audio. */
export class LiveFilter {
  private recent: number[] = [];
  private last: number | null = null;
  private jump: number | null = null;
  private count = 0;
  process(p: Point, s: Settings): Point {
    if (
      p.midi === null ||
      p.conf < s.confidence ||
      (p.rms ?? 0) * s.gain < 10 ** (s.gate / 20) ||
      hz(p.midi) < s.minHz ||
      hz(p.midi) > s.maxHz
    ) {
      this.recent = [];
      this.jump = null;
      this.count = 0;
      return { ...p, midi: null };
    }
    if (s.stability && this.last !== null && Math.abs(p.midi - this.last) > 7) {
      if (this.jump !== null && Math.abs(this.jump - p.midi) < 1) this.count++;
      else {
        this.jump = p.midi;
        this.count = 1;
      }
      if (this.count < 3) return { ...p, midi: null };
      this.recent = [];
    } else {
      this.jump = null;
      this.count = 0;
    }
    this.recent.push(p.midi);
    const n = Math.max(1, Math.round(s.liveSmooth / 33));
    while (this.recent.length > n) this.recent.shift();
    this.last = median(this.recent);
    return { ...p, midi: this.last };
  }
}
export function wav(chunks: Float32Array[], rate: number): Blob {
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new ArrayBuffer(44 + size * 2);
  const v = new DataView(bytes);
  const str = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      v.setUint8(offset + i, text.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + size * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, size * 2, true);
  let i = 44;
  for (const c of chunks)
    for (const x of c) {
      v.setInt16(
        i,
        Math.round(Math.max(-1, Math.min(1, x)) * (x < 0 ? 32768 : 32767)),
        true,
      );
      i += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}
