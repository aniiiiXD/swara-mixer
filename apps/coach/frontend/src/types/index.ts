export type StemName = "vocals" | "drums" | "bass" | "other";

export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

export const STEM_COLORS: Record<StemName, string> = {
  vocals: "#c2785c",
  drums: "#7c8ea6",
  bass: "#8b9e72",
  other: "#b09470",
};

export const STEM_LABELS: Record<StemName, string> = {
  vocals: "VOX",
  drums: "DRM",
  bass: "BAS",
  other: "OTH",
};

export interface StemState {
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
}

export type MixState = Record<StemName, StemState>;

export interface Job {
  id: string;
  url: string;
  status: "pending" | "downloading" | "separating" | "complete" | "error";
  title: string | null;
  duration: number | null;
  progress: number;
  error: string | null;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  channel: string;
  thumbnail: string;
  view_count: number | null;
}

export interface ProgressEvent {
  phase: "downloading" | "separating" | "complete" | "error";
  progress?: number;
  error?: string;
}

export function defaultMixState(): MixState {
  return {
    vocals: { gain: 1.0, pan: 0, mute: false, solo: false },
    drums: { gain: 1.0, pan: 0, mute: false, solo: false },
    bass: { gain: 1.0, pan: 0, mute: false, solo: false },
    other: { gain: 1.0, pan: 0, mute: false, solo: false },
  };
}
