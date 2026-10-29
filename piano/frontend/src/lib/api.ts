// One backend: the piano engine on :8009. Everything lives under /api.
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8009"}/api`;

export interface Note {
  start: number;
  end: number;
  midi: number;
  name: string;
  velocity: number; // 0..127 — grounded in the source track's loudness
}

export interface NotesResponse {
  title: string | null;
  duration: number | null;
  noteCount: number | null;
  notes: Note[];
}

export type Phase =
  | "downloading"
  | "cleaning"
  | "transcribing"
  | "rendering"
  | "complete"
  | "error";

export interface ProgressEvent {
  phase: Phase;
  progress?: number;
  noteCount?: number;
  error?: string;
  skipped?: boolean;
}

export async function createJob(url: string): Promise<{ jobId: string }> {
  // Omit `clean` — the backend decides (de-mud on by default).
  const res = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to start conversion");
  }
  return res.json();
}

export function progressUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/progress`;
}

export async function getNotes(jobId: string): Promise<NotesResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/notes`);
  if (!res.ok) throw new Error("Notes not ready");
  return res.json();
}

export function midiUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/midi`;
}

export function audioUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/audio`;
}
