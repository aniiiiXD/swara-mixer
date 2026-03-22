"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { searchYouTube, createJob } from "@/lib/api";
import type { SearchResult } from "@/types";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViews(count: number | null): string {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}

export function YouTubeInput({
  onJobCreated,
}: {
  onJobCreated: (jobId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setSearching(true);
    setError(null);

    try {
      const res = await searchYouTube(q.trim());
      setResults(res);
    } catch {
      // Only show error if it wasn't an abort
      if (abortRef.current?.signal.aborted) return;
      setError("Search failed. Check that the backend is running.");
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced live search — fires 400ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const handleSelect = async (result: SearchResult) => {
    setSelecting(result.id);
    setError(null);

    try {
      const { jobId } = await createJob(result.url);
      onJobCreated(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start job");
      setSelecting(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Search bar */}
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a song or artist..."
          className="w-full bg-console border border-console-border rounded-lg pl-11 pr-12 py-3.5 text-warm-200 placeholder-warm-700 focus:outline-none focus:border-warm-600 transition-colors text-sm"
        />
        {/* Spinner when searching */}
        {searching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <span className="w-4 h-4 border border-warm-500 border-t-transparent rounded-full animate-spin block" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-[#a65a4e] text-sm mt-3 pl-1">{error}</p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] tracking-[0.2em] uppercase text-warm-600 mb-4 pl-1">
            {results.length} results
          </p>
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => handleSelect(r)}
                disabled={selecting !== null}
                className={`w-full flex items-center gap-4 p-3 rounded-lg border transition-all text-left group animate-fade-up ${
                  selecting === r.id
                    ? "bg-console-raised border-warm-600"
                    : "bg-transparent border-transparent hover:bg-console hover:border-console-border"
                } ${selecting && selecting !== r.id ? "opacity-30" : ""}`}
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                {/* Thumbnail */}
                <div className="w-24 h-14 rounded bg-console-surface overflow-hidden shrink-0 relative">
                  {r.thumbnail ? (
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-warm-700">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  )}
                  <span
                    className="absolute bottom-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-warm-300"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {formatDuration(r.duration)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-300 truncate group-hover:text-warm-100 transition-colors leading-snug">
                    {r.title}
                  </p>
                  <p className="text-xs text-warm-600 mt-1 truncate">
                    {r.channel}
                    {r.view_count ? (
                      <span className="text-warm-700">
                        {" "}&middot; {formatViews(r.view_count)} views
                      </span>
                    ) : null}
                  </p>
                </div>

                {/* Arrow */}
                <div className="shrink-0 pr-1">
                  {selecting === r.id ? (
                    <span className="w-6 h-6 border border-warm-500 border-t-transparent rounded-full animate-spin block" />
                  ) : (
                    <svg
                      className="w-4 h-4 text-warm-700 group-hover:text-warm-400 transition-all group-hover:translate-x-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
