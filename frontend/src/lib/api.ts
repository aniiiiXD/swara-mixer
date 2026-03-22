import type { Job, SearchResult } from "@/types";

const API_BASE = "/api";

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
  return res.json();
}
