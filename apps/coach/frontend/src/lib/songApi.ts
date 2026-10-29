import type { ContourPoint, NoteSeg } from "@/components/ContourGraph";
import { API_ORIGIN } from "@/lib/runtimeConfig";

export const API = API_ORIGIN;

export interface SongInfo {
  jobId: string;
  title: string;
  artist: string;
  duration: number | null;
  thumbnail: string;
  named: boolean;
}

export interface SongMeta {
  title?: string;
  artist?: string;
  duration?: number | null;
  youtube_id?: string;
  thumbnail?: string;
}

export interface Reference {
  duration: number;
  contour: ContourPoint[];
  notes: NoteSeg[];
}

export interface ScoredNote extends NoteSeg {
  sung_midi: number | null;
  cents_off: number | null;
  hit: boolean;
}

export interface Score {
  overall: number;
  intonation: number;
  timing: number;
  median_cents_error: number | null;
  notes: ScoredNote[];
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

export async function searchYouTube(q: string): Promise<SearchResult[]> {
  const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).results as SearchResult[];
}

export async function listSongs(): Promise<SongInfo[]> {
  const r = await fetch(`${API}/songs`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).songs as SongInfo[];
}

export async function createSong(url: string, meta: SongMeta = {}): Promise<string> {
  const r = await fetch(`${API}/songs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...meta }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).jobId as string;
}

export async function getSong(jobId: string): Promise<SongInfo> {
  const r = await fetch(`${API}/songs/${jobId}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function renameSong(jobId: string, title: string): Promise<SongInfo> {
  const r = await fetch(`${API}/songs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function songStatus(jobId: string): Promise<{ status: string; progress: number; title?: string; error?: string }> {
  const r = await fetch(`${API}/songs/${jobId}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getReference(jobId: string): Promise<Reference> {
  const r = await fetch(`${API}/songs/${jobId}/reference`);
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return {
    duration: d.duration,
    notes: d.notes as NoteSeg[],
    contour: (d.contour as { t: number; midi: number | null }[]).map((c) => ({ t: c.t, midi: c.midi })),
  };
}

export function karaokeUrl(jobId: string, withVocals = false): string {
  return `${API}/songs/${jobId}/karaoke${withVocals ? "?vocals=true" : ""}`;
}

/** The isolated vocal stem (Demucs "vocals"), for listen-along playback. */
export function vocalStemUrl(jobId: string): string {
  return `${API}/api/stems/${jobId}/vocals`;
}

export async function scoreTake(jobId: string, clip: Blob): Promise<{ score: Score; user: Reference }> {
  const form = new FormData();
  form.append("file", clip, "take.webm");
  const r = await fetch(`${API}/songs/${jobId}/score`, { method: "POST", body: form });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
