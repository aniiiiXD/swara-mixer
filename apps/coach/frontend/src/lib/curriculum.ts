// Tradition-agnostic curriculum. Exercises use semitone offsets from the tonic
// (Sa / Do), so the same content works in any key and any tradition's labels.

export type TraditionKey = "hindustani" | "western" | "carnatic";

export interface Tradition {
  key: TraditionKey;
  name: string;
  tonicName: string; // "Sa" | "Do"
  accompaniment: "drone" | "metronome";
  degreeLabel: (offset: number) => string; // relative to tonic
}

const SARGAM = ["Sa", "re", "Re", "ga", "Ga", "Ma", "Ma'", "Pa", "dha", "Dha", "ni", "Ni"];
const SOLFEGE = ["Do", "Di", "Re", "Ri", "Mi", "Fa", "Fi", "Sol", "Si", "La", "Li", "Ti"];

function octMark(oct: number): string {
  return oct > 0 ? "'".repeat(oct) : oct < 0 ? ".".repeat(-oct) : "";
}
function labeller(table: string[]) {
  return (offset: number) => {
    const pc = ((offset % 12) + 12) % 12;
    return table[pc] + octMark(Math.floor(offset / 12));
  };
}

export const TRADITIONS: Record<TraditionKey, Tradition> = {
  hindustani: { key: "hindustani", name: "Hindustani", tonicName: "Sa", accompaniment: "drone", degreeLabel: labeller(SARGAM) },
  carnatic: { key: "carnatic", name: "Carnatic", tonicName: "Sa", accompaniment: "drone", degreeLabel: labeller(SARGAM) },
  western: { key: "western", name: "Western", tonicName: "Do", accompaniment: "metronome", degreeLabel: labeller(SOLFEGE) },
};

export interface TargetNote {
  deg: number; // semitone offset from tonic
  beats: number;
}
export interface Exercise {
  id: string;
  title: string;
  about: string;
  target: TargetNote[];
  bpm: number;
}
export interface Lesson {
  id: string;
  title: string;
  about: string;
  exercises: Exercise[];
}

const seq = (degs: number[], beats = 1): TargetNote[] => degs.map((deg) => ({ deg, beats }));

const HINDUSTANI: Lesson[] = [
  {
    id: "h-first",
    title: "First Swaras",
    about: "Find and hold the tonic, then take your first steps.",
    exercises: [
      { id: "h-hold-sa", title: "Hold Sa", about: "Sustain a steady Sa for four beats.", target: [{ deg: 0, beats: 4 }], bpm: 60 },
      { id: "h-sa-re-sa", title: "Sa Re Sa", about: "Step up to Re and back.", target: seq([0, 2, 0]), bpm: 72 },
      { id: "h-sa-re-ga-re-sa", title: "Sa Re Ga Re Sa", about: "Three swaras, up and down.", target: seq([0, 2, 4, 2, 0]), bpm: 80 },
    ],
  },
  {
    id: "h-aroha",
    title: "Aroha–Avaroha",
    about: "The full ascending and descending scale (Bilawal / major).",
    exercises: [
      { id: "h-aroha", title: "Aroha (ascending)", about: "Sa to upper Sa.", target: seq([0, 2, 4, 5, 7, 9, 11, 12]), bpm: 88 },
      { id: "h-avaroha", title: "Avaroha (descending)", about: "Upper Sa back down.", target: seq([12, 11, 9, 7, 5, 4, 2, 0]), bpm: 88 },
    ],
  },
  {
    id: "h-alankar",
    title: "Alankar (Paltas)",
    about: "Patterned runs that build agility.",
    exercises: [
      { id: "h-palta-1", title: "Palta 1", about: "Sa-Re-Ga, Re-Ga-Ma, …", target: seq([0, 2, 4, 2, 4, 5, 4, 5, 7, 5, 7, 9]), bpm: 96 },
    ],
  },
];

const WESTERN: Lesson[] = [
  {
    id: "w-pitch",
    title: "Match the Pitch",
    about: "Train your ear and voice to land on a note.",
    exercises: [
      { id: "w-hold-do", title: "Hold Do", about: "Sustain a steady Do.", target: [{ deg: 0, beats: 4 }], bpm: 60 },
      { id: "w-do-re-do", title: "Do Re Do", about: "Step up a tone and back.", target: seq([0, 2, 0]), bpm: 72 },
    ],
  },
  {
    id: "w-scale",
    title: "Major Scale",
    about: "The do-re-mi scale, ascending and descending.",
    exercises: [
      { id: "w-major-up", title: "Major scale up", about: "Do to upper Do.", target: seq([0, 2, 4, 5, 7, 9, 11, 12]), bpm: 88 },
      { id: "w-major-down", title: "Major scale down", about: "Upper Do back down.", target: seq([12, 11, 9, 7, 5, 4, 2, 0]), bpm: 88 },
    ],
  },
  {
    id: "w-intervals",
    title: "Intervals",
    about: "Leap to a target interval cleanly.",
    exercises: [
      { id: "w-third", title: "Major 3rd", about: "Do → Mi.", target: seq([0, 4, 0]), bpm: 66 },
      { id: "w-fifth", title: "Perfect 5th", about: "Do → Sol.", target: seq([0, 7, 0]), bpm: 66 },
      { id: "w-octave", title: "Octave", about: "Do → Do'.", target: seq([0, 12, 0]), bpm: 60 },
    ],
  },
];

const CARNATIC: Lesson[] = [
  {
    id: "c-sarali",
    title: "Sarali Varisai",
    about: "The foundational beginner exercises.",
    exercises: [
      { id: "c-sarali-1", title: "Sarali 1", about: "Sa Ri Ga Ma Pa Da Ni Sa.", target: seq([0, 2, 4, 5, 7, 9, 11, 12]), bpm: 80 },
      { id: "c-sarali-1-down", title: "Sarali 1 (down)", about: "Descending.", target: seq([12, 11, 9, 7, 5, 4, 2, 0]), bpm: 80 },
    ],
  },
];

export const CURRICULUM: Record<TraditionKey, Lesson[]> = {
  hindustani: HINDUSTANI,
  western: WESTERN,
  carnatic: CARNATIC,
};

/** Flattened exercise order for a tradition (drives the unlock ladder). */
export function flatExercises(t: TraditionKey): { lesson: Lesson; ex: Exercise }[] {
  return CURRICULUM[t].flatMap((lesson) => lesson.exercises.map((ex) => ({ lesson, ex })));
}

export function findExercise(id: string): { tradition: TraditionKey; lesson: Lesson; ex: Exercise } | null {
  for (const t of Object.keys(CURRICULUM) as TraditionKey[]) {
    for (const lesson of CURRICULUM[t]) {
      const ex = lesson.exercises.find((e) => e.id === id);
      if (ex) return { tradition: t, lesson, ex };
    }
  }
  return null;
}
