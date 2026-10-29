"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ContourGraph from "@/components/ContourGraph";
import SongListen from "@/components/SongListen";
import { getReference, listSongs, type Reference, type SongInfo } from "@/lib/songApi";

export default function PitchPage() {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSongs().then(setSongs).catch(() => setError("Your song library could not be loaded."));
  }, []);

  useEffect(() => {
    let active = true;
    const readDeepLink = async () => {
      await Promise.resolve();
      const track = new URLSearchParams(window.location.search).get("track");
      if (active && track) setSelected(track);
    };
    void readDeepLink();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = async () => {
      // Start after the effect commits so changing a route/query never causes
      // a synchronous state cascade during render.
      await Promise.resolve();
      if (!active) return;
      setReference(null);
      setLoading(true);
      setError(null);
      try {
        const next = await getReference(selected);
        if (active) setReference(next);
      } catch {
        if (active) setError("Pitch extraction could not be completed for this track.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [selected]);

  const summary = useMemo(() => {
    if (!reference?.notes.length) return null;
    const midis = reference.notes.map((note) => note.midi);
    return { notes: reference.notes.length, low: Math.min(...midis), high: Math.max(...midis), duration: reference.duration };
  }, [reference]);
  const selectedSong = songs.find((song) => song.jobId === selected);

  return (
    <main className="studio-page">
      <div className="workspace grid max-w-[1440px] gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="workspace-eyebrow">Pitch studio</p>
          <h1 className="workspace-title text-[2.4rem]">See what the song is really doing.</h1>
          <p className="workspace-copy">Inspect the reference vocal, hear its phrasing, then take that map into practice.</p>
          <Link href="/mix" className="mt-4 inline-flex rounded-md border border-[var(--hairline)] px-3 py-2 font-body text-xs text-[var(--ink-dim)] hover:border-[var(--marigold)] hover:text-[var(--ink)]">Open Mixing Studio</Link>

          <div className="mt-7 border-t border-[var(--hairline)] pt-4">
            <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--ink-dim)]">Library</p>
            <div className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto pr-1">
              {songs.map((song) => (
                <button key={song.jobId} onClick={() => setSelected(song.jobId)} className={`rounded-md px-3 py-2 text-left transition-colors ${selected === song.jobId ? "bg-[var(--peacock)]/15 text-[var(--ink)]" : "text-[var(--ink-dim)] hover:bg-white/[0.04] hover:text-[var(--ink)]"}`}>
                  <span className="block truncate font-body text-sm">{song.title}</span>
                  {song.artist && <span className="block truncate pt-0.5 font-body text-xs opacity-70">{song.artist}</span>}
                </button>
              ))}
              {!songs.length && <p className="font-body text-sm text-[var(--ink-dim)]">Separate a song in Mix before inspecting it here.</p>}
            </div>
          </div>
        </aside>

        <section className="studio-panel min-w-0 p-4 sm:p-6">
          {!selected && <EmptyPitchState />}
          {loading && <div className="flex min-h-[460px] items-center justify-center font-body text-sm text-[var(--ink-dim)]">Extracting the reference contour…</div>}
          {error && <div className="flex min-h-[460px] items-center justify-center font-body text-sm text-[var(--vermillion)]">{error}</div>}
          {reference && selected && (
            <div className="flex flex-col gap-6">
              <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--hairline)] pb-4">
                <div><p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--peacock)]">Reference vocal</p><h2 className="mt-1 font-body text-xl font-semibold text-[var(--ink)]">{selectedSong?.title ?? "Pitch contour and note map"}</h2></div>
                {summary && <div className="flex gap-5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--ink-dim)]"><span>{summary.notes} notes</span><span>{summary.duration.toFixed(0)} sec</span><span>MIDI {summary.low}–{summary.high}</span></div>}
              </header>
              <div className="border-b border-[var(--hairline)] pb-5"><ContourGraph points={reference.contour} notes={reference.notes} height={260} /></div>
              <SongListen jobId={selected} reference={reference} />
              <section className="border-t border-[var(--hairline)] pt-5">
                <div className="mb-3 flex items-baseline justify-between gap-4"><div><p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--ink-dim)]">Detected notes</p><h3 className="mt-1 font-body text-base font-semibold text-[var(--ink)]">Phrase inventory</h3></div><span className="font-body text-xs text-[var(--ink-dim)]">First {Math.min(reference.notes.length, 32)} notes</span></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-left"><thead className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[var(--ink-dim)]"><tr className="border-b border-[var(--hairline)]"><th className="py-2 font-normal">#</th><th className="py-2 font-normal">Note</th><th className="py-2 font-normal">Start</th><th className="py-2 font-normal">End</th><th className="py-2 font-normal">Offset</th></tr></thead><tbody className="font-body text-sm text-[var(--ink)]">{reference.notes.slice(0, 32).map((note, index) => <tr key={`${note.start}-${index}`} className="border-b border-[var(--hairline)]/60"><td className="py-2.5 text-[var(--ink-dim)]">{index + 1}</td><td className="py-2.5 font-medium">{note.name}</td><td className="py-2.5 tabular-nums text-[var(--ink-dim)]">{note.start.toFixed(2)}s</td><td className="py-2.5 tabular-nums text-[var(--ink-dim)]">{note.end.toFixed(2)}s</td><td className="py-2.5 tabular-nums text-[var(--ink-dim)]">{note.cents_offset > 0 ? "+" : ""}{note.cents_offset.toFixed(1)}¢</td></tr>)}</tbody></table></div>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyPitchState() {
  return <div className="flex min-h-[460px] max-w-md flex-col justify-center"><p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--peacock)]">No source selected</p><h2 className="mt-3 font-body text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]">Pitch belongs on its own canvas.</h2><p className="mt-3 font-body text-sm leading-6 text-[var(--ink-dim)]">Select a track from the library. The studio will isolate the reference vocal and prepare the contour once, then reuse it on later visits.</p></div>;
}
