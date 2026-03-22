"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { MixingConsole } from "@/components/MixingConsole";
import { Header } from "@/components/Header";
import { getJob } from "@/lib/api";

export default function StudioPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [phase, setPhase] = useState<"processing" | "ready" | "error">("processing");
  const [error, setError] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState<string | null>(null);

  // Fetch song title once available
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    async function fetchTitle() {
      try {
        const job = await getJob(jobId);
        if (job.title) {
          setSongTitle(job.title);
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    }
    fetchTitle();
    interval = setInterval(fetchTitle, 2000);
    return () => clearInterval(interval);
  }, [jobId]);

  const handleComplete = useCallback(() => setPhase("ready"), []);
  const handleError = useCallback((err: string) => {
    setPhase("error");
    setError(err);
  }, []);

  return (
    <main className="flex-1 flex flex-col relative">
      {/* Subtle warmth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(200, 149, 108, 0.03) 0%, transparent 70%)",
        }}
      />

      <Header
        songTitle={songTitle}
        sessionId={jobId}
        showNewTrack={phase === "ready" || phase === "error"}
      />

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-6 relative">
        {phase === "processing" && (
          <div className="animate-fade-up">
            <ProcessingStatus
              jobId={jobId}
              onComplete={handleComplete}
              onError={handleError}
            />
          </div>
        )}

        {phase === "ready" && (
          <div className="w-full animate-fade-up">
            <MixingConsole jobId={jobId} songTitle={songTitle} />
          </div>
        )}

        {phase === "error" && (
          <div className="text-center space-y-5 animate-fade-up">
            <div className="w-12 h-12 mx-auto rounded-full border border-[#6b3a3a] flex items-center justify-center">
              <span className="text-[#a65a4e] text-sm" style={{ fontFamily: "var(--font-serif)" }}>!</span>
            </div>
            <p className="text-[#a65a4e] text-sm">{error}</p>
            <a
              href="/"
              className="inline-block px-5 py-2 border border-console-border hover:border-warm-600 rounded-lg text-xs text-warm-400 tracking-wide transition-colors"
            >
              Try another track
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
