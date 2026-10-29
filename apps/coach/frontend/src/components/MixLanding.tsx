"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { YouTubeInput } from "@/components/YouTubeInput";
import { listSongs, type SongInfo } from "@/lib/songApi";

export function MixLanding() {
  const router = useRouter();
  const [tracks, setTracks] = useState<SongInfo[]>([]);

  useEffect(() => {
    listSongs().then(setTracks).catch(() => {});
  }, []);

  return (
    <main className="studio-page">
      <div className="workspace grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.65fr)] lg:items-end">
        <section className="max-w-2xl py-6">
          <p className="workspace-eyebrow">Mix studio · four stems</p>
          <h1 className="workspace-title">Take the song apart. Keep the feeling intact.</h1>
          <p className="workspace-copy">Prepare vocals, drums, bass, and accompaniment, then work from a calm, focused console.</p>
        </section>

        <section className="studio-panel p-5 sm:p-6">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="font-body text-sm font-semibold text-[var(--ink)]">Open a track</h2>
              <p className="mt-1 font-body text-xs leading-5 text-[var(--ink-dim)]">Search YouTube, then open the finished stems in the console.</p>
            </div>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--ink-dim)]">4 stems</span>
          </div>
          <YouTubeInput onJobCreated={(jobId) => router.push(`/mix/session?job=${jobId}`)} />
        </section>
      </div>

      <section className="workspace pt-0">
        <div className="section-rule" />
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div><p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[var(--ink-dim)]">Prepared tracks</p><h2 className="mt-1 font-body text-lg font-semibold text-[var(--ink)]">Return to a mix</h2></div>
          <Link href="/songs" className="font-body text-sm text-[var(--ink-dim)] hover:text-[var(--marigold)]">Song library ↗</Link>
        </div>
        {!tracks.length ? (
          <p className="font-body text-sm text-[var(--ink-dim)]">Your finished tracks will appear here for mixing and pitch inspection.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tracks.slice(0, 6).map((track) => (
              <Link key={track.jobId} href={`/mix/session?job=${track.jobId}`} className="group rounded-lg border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 transition-colors hover:border-[var(--marigold)] hover:bg-white/[0.04]">
                <p className="truncate font-body text-sm font-medium text-[var(--ink)]">{track.title}</p>
                <p className="mt-1 truncate font-body text-xs text-[var(--ink-dim)]">{track.artist || "Open mixer"}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
