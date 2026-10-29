"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SongPractice from "@/components/SongPractice";
import { getSong, type SongInfo } from "@/lib/songApi";

// Query param rather than a path segment: the desktop build is a static export,
// so every route must be known at build time. Same shape as /pitch?track=.
function SongDetail() {
  const songId = useSearchParams().get("id");
  const [song, setSong] = useState<SongInfo | null>(null);

  useEffect(() => {
    if (!songId) return;
    getSong(songId).then(setSong).catch(() => {});
  }, [songId]);

  return (
    <main className="studio-page"><div className="workspace flex max-w-6xl flex-col gap-5">
      <Link href="/songs" className="font-body text-sm text-[var(--ink-dim)] hover:text-[var(--saffron)]">
        ← back to library
      </Link>
      {!songId ? (
        <p className="font-body text-sm text-[var(--ink-dim)]">No song selected.</p>
      ) : (
        <>
          <header>
            <h1 className="font-display text-3xl italic text-[var(--ink)]">
              {song?.title ?? "…"}
            </h1>
            {song?.artist && <p className="font-body text-sm text-[var(--ink-dim)]">{song.artist}</p>}
          </header>
          <SongPractice initialJobId={songId} />
        </>
      )}
    </div></main>
  );
}

export default function SongDetailPage() {
  return (
    <Suspense fallback={null}>
      <SongDetail />
    </Suspense>
  );
}
