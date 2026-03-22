"use client";

import { useEffect, useRef } from "react";
import { useSSE } from "@/hooks/useSSE";
import { getProgressUrl, getJob } from "@/lib/api";

export function ProcessingStatus({
  jobId,
  onComplete,
  onError,
}: {
  jobId: string;
  onComplete: () => void;
  onError: (error: string) => void;
}) {
  const { event } = useSSE(getProgressUrl(jobId));
  const calledRef = useRef(false);

  const phase = event?.phase || "pending";
  const progress = event?.progress || 0;

  // Primary path: SSE events
  useEffect(() => {
    if (calledRef.current) return;
    if (phase === "complete") {
      calledRef.current = true;
      onComplete();
    } else if (phase === "error") {
      calledRef.current = true;
      onError(event?.error || "Unknown error");
    }
  }, [phase, event, onComplete, onError]);

  // Fallback: poll job status every 5s in case SSE doesn't deliver
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      if (calledRef.current) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      try {
        const job = await getJob(jobId);
        if (job.status === "complete" && !calledRef.current) {
          calledRef.current = true;
          if (intervalRef.current) clearInterval(intervalRef.current);
          onComplete();
        } else if (job.status === "error" && !calledRef.current) {
          calledRef.current = true;
          if (intervalRef.current) clearInterval(intervalRef.current);
          onError(job.error || "Unknown error");
        }
      } catch {
        // ignore polling errors
      }
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId, onComplete, onError]);

  const phaseLabel =
    phase === "downloading"
      ? "Downloading audio"
      : phase === "separating"
      ? "Separating stems"
      : phase === "complete"
      ? "Ready"
      : phase === "error"
      ? "Error"
      : "Preparing";

  return (
    <div className="w-full max-w-md mx-auto space-y-8 text-center">
      {/* Phase label */}
      <div className="space-y-2">
        <p
          className="text-warm-200 text-lg"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {phaseLabel}
        </p>
        <p className="text-warm-600 text-xs tracking-wide">
          {phase === "downloading"
            ? "Fetching audio from source"
            : phase === "separating"
            ? "Meta Demucs is isolating stems — this may take a minute"
            : phase === "pending"
            ? "Initializing pipeline"
            : ""}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-3">
        <div className="h-1 bg-console rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${progress}%`,
              background: "var(--color-amber-accent)",
              opacity: phase === "error" ? 0.4 : 0.9,
            }}
          />
        </div>
        <div className="flex justify-between items-center">
          <span
            className="text-[10px] tracking-[0.15em] text-warm-600"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {phase === "downloading" ? "DOWNLOAD" : phase === "separating" ? "DEMUCS" : "INIT"}
          </span>
          <span
            className="text-[10px] text-warm-500"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-8 text-[10px] tracking-[0.15em] uppercase">
        <span
          className={
            phase === "downloading"
              ? "text-amber-accent"
              : phase !== "pending"
              ? "text-warm-600"
              : "text-warm-800"
          }
        >
          Download
        </span>
        <span className="text-warm-800">&rarr;</span>
        <span
          className={
            phase === "separating"
              ? "text-amber-accent"
              : phase === "complete"
              ? "text-warm-600"
              : "text-warm-800"
          }
        >
          Separate
        </span>
        <span className="text-warm-800">&rarr;</span>
        <span className={phase === "complete" ? "text-amber-accent" : "text-warm-800"}>
          Mix
        </span>
      </div>
    </div>
  );
}
