"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import FallingNotes from "@/components/FallingNotes";
import {
  createJob,
  progressUrl,
  getNotes,
  midiUrl,
  audioUrl,
  type Note,
  type Phase,
  type ProgressEvent,
} from "@/lib/api";

type Status = "idle" | "working" | "ready" | "error";

const STEPS: { key: Phase; label: string }[] = [
  { key: "downloading", label: "Download" },
  { key: "cleaning", label: "Separate" },
  { key: "transcribing", label: "Transcribe" },
  { key: "rendering", label: "Render" },
];

const PHASE_LABEL: Record<Phase, string> = {
  downloading: "Downloading audio",
  cleaning: "Separating out bass & drums",
  transcribing: "Composing the piano cover",
  rendering: "Rendering the piano",
  complete: "Done",
  error: "Error",
};

function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState<Phase>("downloading");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState<string | null>(null);

  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const submit = useCallback(async () => {
    if (!url.trim()) return;
    esRef.current?.close();
    setStatus("working");
    setPhase("downloading");
    setProgress(0);
    setErrorMsg("");
    setNotes([]);
    setTitle(null);

    try {
      const { jobId } = await createJob(url.trim());
      setJobId(jobId);

      const es = new EventSource(progressUrl(jobId));
      esRef.current = es;
      es.onmessage = async (e) => {
        const ev: ProgressEvent = JSON.parse(e.data);
        setPhase(ev.phase);
        if (typeof ev.progress === "number") setProgress(ev.progress);
        if (ev.phase === "complete") {
          es.close();
          try {
            const data = await getNotes(jobId);
            setNotes(data.notes);
            setTitle(data.title);
            setStatus("ready");
          } catch {
            setErrorMsg("Conversion finished but notes could not be loaded.");
            setStatus("error");
          }
        } else if (ev.phase === "error") {
          es.close();
          setErrorMsg(ev.error || "Conversion failed.");
          setStatus("error");
        }
      };
      es.onerror = () => {
        es.close();
        setErrorMsg("Lost connection to the server.");
        setStatus("error");
      };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, [url]);

  const togglePlay = useCallback(() => {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  }, [audioEl]);

  const seek = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!audioEl || !dur) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      audioEl.currentTime = Math.max(0, Math.min(1, frac)) * dur;
    },
    [audioEl, dur]
  );

  const reset = () => {
    esRef.current?.close();
    setStatus("idle");
    setUrl("");
    setJobId(null);
    setNotes([]);
    setPlaying(false);
    setTime(0);
  };

  const activeStep = STEPS.findIndex((s) => s.key === phase);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10">
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="mb-8">
        <h1
          className="text-4xl tracking-tight text-ink"
          style={{ fontFamily: "var(--font-display), serif", fontStyle: "italic" }}
        >
          Piano
        </h1>
        <p className="mt-1 text-sm text-ink-dim">
          Turn any song into an AI piano cover — watch it play, download the MIDI.
        </p>
      </header>

      {/* ── input ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-night-2/70 p-4 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && status !== "working" && submit()}
          placeholder="Paste a YouTube URL…"
          disabled={status === "working"}
          className="flex-1 rounded-lg border border-border bg-night px-4 py-3 text-ink outline-none placeholder:text-ink-dim/60 focus:border-amber/60 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={status === "working" || !url.trim()}
          className="rounded-lg bg-amber px-6 py-3 font-medium text-night transition hover:bg-amber-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "working" ? "Converting…" : "Convert"}
        </button>
      </div>

      {/* ── progress ───────────────────────────────────────────── */}
      {status === "working" && (
        <section className="mt-6 rounded-xl border border-border bg-night-2/70 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm text-ink">
            <span className="pulse-dot h-2 w-2 rounded-full bg-amber" />
            {PHASE_LABEL[phase]}
            {phase !== "transcribing" && progress > 0 && (
              <span className="text-ink-dim">· {Math.round(progress)}%</span>
            )}
          </div>
          <div className="flex gap-2">
            {STEPS.map((s, i) => {
              const done = activeStep > i;
              const current = activeStep === i;
              return (
                <div key={s.key} className="flex-1">
                  <div
                    className={`h-1.5 overflow-hidden rounded-full ${
                      done || current ? "bg-border" : "bg-border/40"
                    }`}
                  >
                    <div
                      className="h-full rounded-full bg-amber transition-all duration-300"
                      style={{
                        width: done ? "100%" : current ? `${Math.max(8, progress)}%` : "0%",
                      }}
                    />
                  </div>
                  <div
                    className={`mt-1.5 text-xs ${
                      current ? "text-amber" : done ? "text-ink-dim" : "text-ink-dim/50"
                    }`}
                  >
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-ink-dim/70">
            Transcription runs a neural model on CPU — a full song takes a minute or two.
          </p>
        </section>
      )}

      {/* ── error ──────────────────────────────────────────────── */}
      {status === "error" && (
        <section className="mt-6 rounded-xl border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm text-red-300">{errorMsg}</p>
          <button onClick={reset} className="mt-3 text-sm text-amber hover:underline">
            Try another song
          </button>
        </section>
      )}

      {/* ── result / player ────────────────────────────────────── */}
      {status === "ready" && jobId && (
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg text-ink" title={title ?? undefined}>
              {title ?? "Your piano cover"}
            </h2>
            <span className="text-xs text-ink-dim">{notes.length} notes</span>
          </div>

          {/* visualizer */}
          <div className="relative h-[460px] overflow-hidden rounded-xl border border-border bg-[#141110]">
            <FallingNotes notes={notes} audioEl={audioEl} />
          </div>

          {/* transport */}
          <div className="mt-3 flex items-center gap-4 rounded-xl border border-border bg-night-2/70 px-4 py-3">
            <button
              onClick={togglePlay}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber text-night transition hover:bg-amber-deep"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="2" width="4" height="12" rx="1" />
                  <rect x="9" y="2" width="4" height="12" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" />
                </svg>
              )}
            </button>
            <span className="w-11 shrink-0 text-xs tabular-nums text-ink-dim">{fmt(time)}</span>
            <div
              onClick={seek}
              className="group relative h-2 flex-1 cursor-pointer rounded-full bg-border"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-amber"
                style={{ width: dur ? `${(time / dur) * 100}%` : "0%" }}
              />
            </div>
            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-ink-dim">{fmt(dur)}</span>
          </div>

          {/* downloads */}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={audioUrl(jobId)}
              download="piano.wav"
              className="rounded-lg border border-border bg-night-2 px-4 py-2 text-sm text-ink transition hover:border-amber/60"
            >
              ↓ Download WAV
            </a>
            <a
              href={midiUrl(jobId)}
              download="piano.mid"
              className="rounded-lg border border-border bg-night-2 px-4 py-2 text-sm text-ink transition hover:border-amber/60"
            >
              ↓ Download MIDI
            </a>
            <button
              onClick={reset}
              className="ml-auto rounded-lg px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
            >
              New song
            </button>
          </div>
        </section>
      )}

      {/* audio element — driven by the transport, read by the visualizer */}
      {jobId && status === "ready" && (
        <audio
          ref={(el) => setAudioEl(el)}
          src={audioUrl(jobId)}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </main>
  );
}
