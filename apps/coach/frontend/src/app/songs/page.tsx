"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  type SearchResult,
  type SongInfo,
  createSong,
  listSongs,
  renameSong,
  searchYouTube,
  songStatus,
} from "@/lib/songApi";

function fmt(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SongsPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [importJob, setImportJob] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<Record<string, string>>({}); // youtubeId -> phase
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => listSongs().then(setSongs).catch((e) => setError(String(e))), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!importJob) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const st = await songStatus(importJob);
        if (cancelled) return;
        failures = 0;
        if (st.status === "error") {
          setError(st.error || "Could not prepare this song. Try the link again.");
          setImportJob(null);
          setImportProgress(null);
          return;
        }
        if (st.status === "complete") {
          router.push(`/songs/view?id=${encodeURIComponent(importJob)}`);
          return;
        }
        const phase = st.status === "pending" ? "Queued" : st.status === "downloading" ? "Downloading audio" : "Separating vocals";
        setImportProgress(`${phase} · ${Math.round(st.progress)}%`);
      } catch (e) {
        if (cancelled) return;
        if (++failures >= 3) {
          setError(`Lost connection while preparing the song: ${e instanceof Error ? e.message : String(e)}. Check the library once processing finishes.`);
          setImportJob(null);
          setImportProgress(null);
          return;
        }
        setImportProgress("Reconnecting…");
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [importJob, router]);

  const importUrl = async () => {
    if (!url.trim() || importProgress) return;
    setError(null);
    setImportProgress("Starting…");
    try {
      const parsed = new URL(url.trim());
      if (!["https:", "http:"].includes(parsed.protocol) ||
          !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname)) {
        throw new Error("Paste a YouTube video link.");
      }
      setImportJob(await createSong(parsed.href));
    } catch (e) {
      setError(`Could not add song: ${e instanceof Error ? e.message : String(e)}`);
      setImportProgress(null);
    }
  };

  const search = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchYouTube(q.trim()));
    } catch (e) {
      setError(`search failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearching(false);
    }
  }, [q]);

  const add = useCallback(
    async (r: SearchResult) => {
      setError(null);
      setAdding((a) => ({ ...a, [r.id]: "starting…" }));
      try {
        const jobId = await createSong(r.url, {
          title: r.title,
          artist: r.channel,
          duration: r.duration,
          youtube_id: r.id,
          thumbnail: r.thumbnail,
        });
        const poll = setInterval(async () => {
          try {
            const st = await songStatus(jobId);
            setAdding((a) => ({ ...a, [r.id]: `${st.status} ${Math.round(st.progress)}%` }));
            if (st.status === "complete") {
              clearInterval(poll);
              setAdding((a) => {
                const n = { ...a };
                delete n[r.id];
                return n;
              });
              refresh();
            } else if (st.status === "error") {
              clearInterval(poll);
              setAdding((a) => ({ ...a, [r.id]: "error" }));
            }
          } catch {
            /* keep polling */
          }
        }, 1500);
      } catch (e) {
        setError(`add failed: ${e instanceof Error ? e.message : String(e)}`);
        setAdding((a) => {
          const n = { ...a };
          delete n[r.id];
          return n;
        });
      }
    },
    [refresh],
  );

  return (
    <main className="studio-page">
      <div className="workspace flex max-w-6xl flex-col gap-8">
      <header>
        <p className="workspace-eyebrow">Track library</p>
        <h1 className="workspace-title">Your material, ready for practice.</h1>
        <p className="workspace-copy">Paste a YouTube link, see the singer’s pitch, and practise with your live ghost pitch over it.</p>
      </header>

      <section className="studio-panel p-4 sm:p-5">
        <form onSubmit={(e) => { e.preventDefault(); void importUrl(); }}>
          <label htmlFor="song-url" className="mb-2 block font-body text-sm">Practise a YouTube song</label>
          <div className="flex flex-wrap gap-2">
            <input id="song-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)}
              disabled={!!importProgress} placeholder="https://www.youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] bg-white/[0.03] px-4 py-2.5 font-body outline-none focus:border-[var(--saffron)]" />
            <button type="submit" disabled={!!importProgress || !url.trim()}
              className="rounded-lg bg-[var(--saffron)] px-5 py-2.5 font-body font-medium text-neutral-950 disabled:opacity-50">
              {importProgress ? "Preparing…" : "Show singer’s pitch"}
            </button>
          </div>
          <p role="status" className="mt-2 font-body text-xs text-[var(--ink-dim)]">
            {importProgress ?? "We isolate the vocal and draw its melody. Then enable your microphone to overlay your voice. First-time preparation can take a few minutes."}
          </p>
        </form>
      </section>

      {/* search */}
      <section className="studio-panel p-4 sm:p-5">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="search YouTube — song or artist…"
            className="font-body flex-1 rounded-lg border border-[var(--hairline)] bg-white/[0.03] px-4 py-2.5 outline-none placeholder:text-[var(--ink-dim)]/60 focus:border-[var(--saffron)]"
          />
          <button
            onClick={search}
            disabled={searching}
            className="rounded-lg bg-[var(--saffron)]/90 px-5 py-2.5 font-body font-medium text-neutral-950 hover:bg-[var(--saffron)] disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-[var(--hairline)]">
            {results.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail} alt="" className="h-12 w-20 rounded object-cover" />
                ) : (
                  <div className="h-12 w-20 rounded bg-white/5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-body truncate text-sm text-[var(--ink)]">{r.title}</div>
                  <div className="font-body truncate text-xs text-[var(--ink-dim)]">
                    {r.channel} {r.duration ? `· ${fmt(r.duration)}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => add(r)}
                  disabled={!!adding[r.id]}
                  className="shrink-0 rounded-lg border border-[var(--hairline)] px-3 py-1.5 font-body text-sm text-[var(--ink-dim)] hover:border-[var(--saffron)] hover:text-[var(--saffron)] disabled:opacity-60"
                >
                  {adding[r.id] ?? "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p role="alert" className="font-body text-sm text-[var(--vermillion)]">{error}</p>}

      {/* library */}
      <section>
        <h2 className="font-display mb-3 text-lg italic text-[var(--ink-dim)]">Your library</h2>
        {songs.length === 0 ? (
          <p className="font-body text-sm text-[var(--ink-dim)]">no songs yet — search above to add one.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {songs.map((s) => (
              <div key={s.jobId} className="studio-panel group relative overflow-hidden">
                <Link href={`/songs/view?id=${s.jobId}`} className="flex flex-col">
                  {s.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnail} alt="" className="h-28 w-full object-cover opacity-90" />
                  ) : (
                    <div className="flex h-28 w-full items-center justify-center bg-white/[0.03] font-display text-3xl italic text-[var(--ink-dim)]/40">
                      ♪
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 p-3">
                    <span className="font-body truncate text-sm text-[var(--ink)]">{s.title}</span>
                    <span className="font-body truncate text-xs text-[var(--ink-dim)]">
                      {s.artist || (s.named ? "" : "tap ✎ to name")}
                    </span>
                  </div>
                </Link>
                <button
                  onClick={async () => {
                    const t = window.prompt("Song title", s.title === "Untitled song" ? "" : s.title);
                    if (t && t.trim()) {
                      await renameSong(s.jobId, t.trim());
                      refresh();
                    }
                  }}
                  title="Rename"
                  className="absolute right-2 top-2 rounded-md bg-black/40 px-2 py-1 text-xs text-[var(--ink-dim)] opacity-0 backdrop-blur transition-opacity hover:text-[var(--saffron)] group-hover:opacity-100"
                >
                  ✎
                </button>
              </div>
            ))}
          </div>
        )}
      </section></div>
    </main>
  );
}
