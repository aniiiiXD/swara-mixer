// Local-first progress (localStorage). Migrates to the `mastery`/`profiles`
// tables when auth + DB land (ROADMAP M0/M2).

import { flatExercises, type TraditionKey } from "./curriculum";

const PASS = 75; // score needed to pass an exercise
const K = {
  sa: "tonic:saHz",
  tradition: "tonic:tradition",
  mastery: "tonic:mastery",
};

export interface Mastery {
  best: number;
  passed: boolean;
}

const isBrowser = typeof window !== "undefined";

export function getSaHz(): number {
  if (!isBrowser) return 261.63;
  return Number(localStorage.getItem(K.sa)) || 261.63; // C4 default
}
export function setSaHz(hz: number) {
  if (isBrowser) localStorage.setItem(K.sa, String(hz));
}

export function getTradition(): TraditionKey {
  if (!isBrowser) return "hindustani";
  return (localStorage.getItem(K.tradition) as TraditionKey) || "hindustani";
}
export function setTradition(t: TraditionKey) {
  if (isBrowser) localStorage.setItem(K.tradition, t);
}

export function getMastery(): Record<string, Mastery> {
  if (!isBrowser) return {};
  try {
    return JSON.parse(localStorage.getItem(K.mastery) || "{}");
  } catch {
    return {};
  }
}

export function recordAttempt(exerciseId: string, score: number): Mastery {
  const all = getMastery();
  const prev = all[exerciseId];
  const best = Math.max(prev?.best ?? 0, score);
  const m: Mastery = { best, passed: best >= PASS };
  all[exerciseId] = m;
  if (isBrowser) localStorage.setItem(K.mastery, JSON.stringify(all));
  return m;
}

export { PASS };

/** An exercise is unlocked if it's first, or the previous one (in order) is passed. */
export function unlockedSet(t: TraditionKey): Set<string> {
  const order = flatExercises(t);
  const mastery = getMastery();
  const open = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const id = order[i].ex.id;
    if (i === 0 || mastery[order[i - 1].ex.id]?.passed) open.add(id);
    else break; // ladder stops at first locked
  }
  return open;
}
