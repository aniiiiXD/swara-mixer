export interface Point {
  t: number;
  midi: number | null;
  conf: number;
  rms?: number;
}
export interface Track {
  id: string;
  name: string;
  kind: "vocals" | "drums" | "bass" | "other" | "take" | "original";
  start: number;
  duration: number;
  peaks: number[];
  volume: number;
  muted: boolean;
  solo: boolean;
  color: string;
  analysis: "none" | "pending" | "ready" | "error";
  analysisError?: string;
}
export interface Project {
  id: string;
  title: string;
  duration: number;
  tracks: Track[];
  status: "uploaded" | "separating" | "ready" | "error";
  progress: number;
  error?: string;
  settings: Partial<Settings>;
}
export interface Settings {
  focusPitch: boolean;
  referenceCleanup: boolean;
  referenceSilence: number;
  referenceSmooth: number;
  referenceGate: number;
  takeSmooth: number;
  showRaw: boolean;
  gate: number;
  confidence: number;
  liveSmooth: number;
  stability: boolean;
  gain: number;
  minHz: number;
  maxHz: number;
  latency: number;
  zoom: number;
  tonic: number;
  notation: "notes" | "swaras";
}
export const defaults: Settings = {
  focusPitch: true,
  referenceCleanup: true,
  referenceSilence: -62,
  referenceSmooth: 50,
  referenceGate: 0.12,
  takeSmooth: 70,
  showRaw: false,
  gate: -55,
  confidence: 0.78,
  liveSmooth: 90,
  stability: true,
  gain: 1,
  minHz: 55,
  maxHz: 1500,
  latency: 0,
  zoom: 12,
  tonic: 0,
  notation: "notes",
};
export const API =
  process.env.NEXT_PUBLIC_STUDIO_API || "http://localhost:8010";
export const audioUrl = (pid: string, tid: string) =>
  `${API}/projects/${pid}/tracks/${tid}/audio`;
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) {
    let message = await r.text();
    try {
      message = JSON.parse(message).detail;
    } catch {}
    throw new Error(String(message));
  }
  return r.json();
}
export function patch<T>(path: string, body: unknown) {
  return api<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
