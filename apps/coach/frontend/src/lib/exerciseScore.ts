import type { NoteSeg } from "@/components/ContourGraph";
import type { TargetNote } from "@/lib/curriculum";

export interface ScoredTarget {
  deg: number;
  sungMidi: number | null;
  cents: number | null;
  hit: boolean;
}
export interface ExerciseScore {
  overall: number;
  targets: ScoredTarget[];
}

const TOL_CENTS = 60; // within ~half a semitone counts as on-pitch

/** Collapse consecutive identical degrees (a held note is one target). */
function collapse(target: TargetNote[]): number[] {
  const out: number[] = [];
  for (const n of target) if (out.length === 0 || out[out.length - 1] !== n.deg) out.push(n.deg);
  return out;
}

export function scoreExercise(target: TargetNote[], userNotes: NoteSeg[], saMidi: number): ExerciseScore {
  const degs = collapse(target);
  const sung = userNotes.map((n) => n.midi); // in time order
  const targets: ScoredTarget[] = [];
  let sum = 0;

  for (let i = 0; i < degs.length; i++) {
    const targetMidi = saMidi + degs[i];
    const userMidi = i < sung.length ? sung[i] : null;
    if (userMidi === null) {
      targets.push({ deg: degs[i], sungMidi: null, cents: null, hit: false });
      continue;
    }
    // octave-fold the error so an octave-off match still scores partially
    let semis = userMidi - targetMidi;
    while (semis > 6) semis -= 12;
    while (semis < -6) semis += 12;
    const cents = semis * 100;
    const hit = Math.abs(cents) <= TOL_CENTS;
    sum += Math.max(0, 1 - Math.abs(semis) / 1); // 1 semitone off -> 0
    targets.push({ deg: degs[i], sungMidi: Math.round(userMidi * 100) / 100, cents: Math.round(cents), hit });
  }

  const overall = Math.round((sum / degs.length) * 100);
  return { overall, targets };
}

export const saHzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
