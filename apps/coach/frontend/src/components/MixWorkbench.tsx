"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { MixingConsole } from "@/components/MixingConsole";
import { getJob } from "@/lib/api";

export function MixWorkbench({ jobId }: { jobId: string }) {
  const [phase, setPhase] = useState<"processing" | "ready" | "error">("processing");
  const [error, setError] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState<string | null>(null);

  useEffect(() => {
    const fetchTitle = async () => {
      try {
        const job = await getJob(jobId);
        if (job.title) {
          setSongTitle(job.title);
        }
      } catch {
        // ProcessingStatus owns terminal job failures.
      }
    };
    void fetchTitle();
    const timer = setInterval(fetchTitle, 2000);
    return () => clearInterval(timer);
  }, [jobId]);

  const handleComplete = useCallback(() => setPhase("ready"), []);
  const handleError = useCallback((message: string) => {
    setPhase("error");
    setError(message);
  }, []);

  return (
    <main className="studio-page"><div className="workspace max-w-[1440px] px-4 py-5 sm:px-6 lg:px-10">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 border-b border-[var(--hairline)] pb-4">
        <div className="min-w-0">
          <Link href="/mix" className="font-body text-xs uppercase tracking-[0.18em] text-[var(--ink-dim)] hover:text-[var(--marigold)]">Mixing Studio</Link>
          <h1 className="mt-1 truncate font-body text-lg font-semibold text-[var(--ink)]">{songTitle ?? "Preparing track"}</h1>
        </div>
        <Link href="/mix" className="rounded-md border border-[var(--hairline)] px-3 py-2 font-body text-xs text-[var(--ink-dim)] transition-colors hover:border-[var(--marigold)] hover:text-[var(--ink)]">New track</Link>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center py-6">
        {phase === "processing" && <ProcessingStatus jobId={jobId} onComplete={handleComplete} onError={handleError} />}
        {phase === "ready" && <div className="flex flex-col gap-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--hairline)] bg-white/[0.02] px-4 py-3"><p className="font-body text-sm text-[var(--ink-dim)]">Stems are ready. Shape the balance here, or inspect the reference vocal in Pitch.</p><Link href={`/pitch?track=${jobId}`} className="rounded-md border border-[var(--peacock)]/50 px-3 py-2 font-body text-xs text-[var(--peacock)] hover:border-[var(--peacock)] hover:text-[var(--ink)]">Open Pitch Studio</Link></div><MixingConsole jobId={jobId} songTitle={songTitle} /></div>}
        {phase === "error" && (
          <section className="mx-auto max-w-md py-20 text-center">
            <p className="font-body text-sm text-[var(--vermillion)]">{error ?? "This track could not be prepared."}</p>
            <Link href="/mix" className="mt-5 inline-flex rounded-md border border-[var(--hairline)] px-4 py-2 font-body text-sm text-[var(--ink-dim)] hover:border-[var(--marigold)] hover:text-[var(--ink)]">Try another track</Link>
          </section>
        )}
      </div>
    </div></main>
  );
}
