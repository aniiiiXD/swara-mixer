import type { Job, SearchResult } from "@/types";
import { API_ORIGIN } from "@/lib/runtimeConfig";

// One API: everything goes to the Tonic backend, which reverse-proxies the
// separation engine under /api. (Coach features use songApi.ts, same origin.)
const API_BASE = `${API_ORIGIN}/api`;

export async function searchYouTube(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  return data.results;
}

export async function createJob(url: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to create job");
  }
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to get job");
  return res.json();
}

export function getStemUrl(jobId: string, stem: string): string {
  return `${API_BASE}/stems/${jobId}/${stem}`;
}

export function getProgressUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/progress`;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

export async function getCaptions(jobId: string): Promise<Caption[]> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/captions`);
  if (!res.ok) throw new Error("No captions available");
  const data = await res.json();
  return data.cues;
}

export async function exportMix(
  jobId: string,
  mix: Record<string, { gain: number; pan: number; mute: boolean }>
): Promise<{ downloadUrl: string }> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mix }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Export failed");
  }
  const data = await res.json();
  return {
    ...data,
    // The API returns an absolute-path route. Resolve it against the API, not
    // the Next.js origin, so exports work when the two run on different ports.
    downloadUrl: data.downloadUrl.startsWith("http")
      ? data.downloadUrl
      : `${API_BASE.replace(/\/api$/, "")}${data.downloadUrl}`,
  };
}
