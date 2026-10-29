"use client";

import { useCallback, useRef, useState } from "react";
import PitchGraph from "@/components/PitchGraph";
import ContourGraph, { type ContourPoint, type NoteSeg } from "@/components/ContourGraph";
import SwaraLabel from "@/components/SwaraLabel";
import SongPractice from "@/components/SongPractice";
import { LiveDetector, centsColor, midiToSwara, type PitchSample } from "@/lib/pitch";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8008";
const BUFFER_SECONDS = 30;

export default function Today() {
  const samplesRef = useRef<PitchSample[]>([]);
  const detectorRef = useRef<LiveDetector | null>(null);

  const [mode, setMode] = useState<"freestyle" | "song">("freestyle");
  const [notation, setNotation] = useState<"indian" | "english">("indian");
  const [running, setRunning] = useState(false);
  const [liveMidi, setLiveMidi] = useState<number | null>(null);
  const [liveCents, setLiveCents] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState<NoteSeg[] | null>(null);
  const [accurateContour, setAccurateContour] = useState<ContourPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSample = useCallback((s: PitchSample) => {
    const buf = samplesRef.current;
    buf.push(s);
    const cutoff = s.time - BUFFER_SECONDS;
    while (buf.length && buf[0].time < cutoff) buf.shift();
    if (s.hz !== null && s.midi !== null) {
      setLiveMidi(s.midi);
      setLiveCents(Math.round((s.midi - Math.round(s.midi)) * 100));
    } else {
      setLiveMidi(null);
      setLiveCents(0);
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setNotes(null);
    setAccurateContour(null);
    samplesRef.current = [];
    const det = new LiveDetector({ onSample: handleSample });
    detectorRef.current = det;
    try {
      await det.start();
      setRunning(true);
    } catch (e) {
      setError(`mic error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [handleSample]);

  const stop = useCallback(async () => {
    const det = detectorRef.current;
    if (!det) return;
    setRunning(false);
    setLiveMidi(null);

    const clip = await det.stop();
    detectorRef.current = null;
    if (!clip) return;

    setAnalyzing(true);
    try {
      const form = new FormData();
      form.append("file", clip, "take.webm");
      const res = await fetch(`${API}/analyze`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setNotes(data.notes as NoteSeg[]);
      setAccurateContour(
        (data.contour as { t: number; midi: number | null }[]).map((c) => ({
          t: c.t,
          midi: c.midi,
        })),
      );
    } catch (e) {
      setError(`analysis error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const liveColor = liveMidi === null ? "var(--ink-dim)" : centsColor(liveCents);

  return (
    <main className="coach-page">
    <div className="workspace relative flex max-w-6xl flex-col gap-8">
      {/* ── Header ── */}
      <header className="coach-session-header rise">
        <div>
          <p className="workspace-eyebrow">Today&apos;s practice</p>
          <h1 className="workspace-title">Meet your voice where it is.</h1>
          <p className="workspace-copy">Warm up freely, or use a song as your guide. Tonic keeps the next note visible without getting in the way.</p>
        </div>

        <div className="coach-mode-switch" role="tablist" aria-label="Practice mode">
          {/* mode toggle */}
          <div className="flex rounded-full border border-[var(--hairline)] bg-white/[0.03] p-1 text-sm">
            {(["freestyle", "song"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 font-body transition-colors ${
                  mode === m ? "coach-mode-switch__button--active" : ""
                }`}
                role="tab"
                aria-selected={mode === m}
              >
                {m === "freestyle" ? "Freestyle" : "Song"}
              </button>
            ))}
          </div>

        </div>
        {mode === "freestyle" && <div className="coach-notation-switch" role="group" aria-label="Pitch notation">
          <span>Notation</span>
          {(["indian", "english"] as const).map((kind) => <button key={kind} onClick={() => setNotation(kind)} className={notation === kind ? "coach-notation-switch__active" : ""}>{kind === "indian" ? "Swaras" : "Notes"}</button>)}
        </div>}
      </header>

      <div className="gold-rule rise" style={{ animationDelay: "80ms" }} />

      {mode === "song" && <SongPractice />}

      {mode === "freestyle" && (
        <>
          <div className="coach-live-layout rise" style={{ animationDelay: "140ms" }}>
          <section className="coach-live-stage">
            <div className="coach-live-stage__topline"><span>Live canvas</span><span>{running ? "Recording" : "Ready when you are"}</span></div>
            <div className="h-[380px] w-full"><PitchGraph samplesRef={samplesRef} running={running} notation={notation} followPitch /></div>
          </section>

          <aside className="coach-live-sidebar">
            <p className="font-mono text-[.64rem] uppercase tracking-[.15em] text-[var(--ink-dim)]">Your note</p>
            <div className="coach-note-readout" style={{ color: liveColor }}>
              {liveMidi === null ? <span className="font-deva text-7xl opacity-25">·</span> : <SwaraLabel midi={liveMidi} size={76} showLatin />}
              <span className="font-body text-sm tabular-nums">{liveMidi === null ? "Listening" : `${liveCents > 0 ? "+" : ""}${liveCents}¢`}</span>
            </div>
            <button
              onClick={running ? stop : start}
              className={`group relative flex h-20 w-20 items-center justify-center rounded-full border transition-all ${
                running
                  ? "breathe border-[var(--vermillion)] bg-[var(--vermillion)]/15"
                  : "border-[var(--hairline)] bg-white/5 hover:border-[var(--saffron)] hover:bg-[var(--saffron)]/10"
              }`}
              aria-label={running ? "Stop" : "Start singing"}
            >
              <span
                className={`block transition-all ${
                  running
                    ? "h-6 w-6 rounded-[4px] bg-[var(--vermillion)]"
                    : "h-7 w-7 rounded-full bg-[var(--saffron)] shadow-[0_0_24px_var(--saffron)]"
                }`}
              />
            </button>
            <div className="font-body text-center text-sm text-[var(--ink-dim)]">
              {running ? (
                <span className="text-[var(--saffron)]">
                  {liveMidi === null ? "● listening for a clear note…" : "● recording — tap to finish"}
                </span>
              ) : analyzing ? (
                <span>analyzing your take…</span>
              ) : (
                <span>tap to begin</span>
              )}
              {error && <div className="mt-1 text-[var(--vermillion)]">{error}</div>}
            </div>
            <div className="coach-live-sidebar__hint"><span>1</span> Use headphones for a cleaner signal.</div>
          </aside></div>

          {accurateContour && (
            <section className="rise coach-panel p-4">
              <h2 className="font-display mb-3 text-lg italic text-[var(--ink)]">
                Analysis{" "}
                <span className="font-body text-xs not-italic text-[var(--ink-dim)]">· raw recorded audio (pYIN)</span>
              </h2>
              <ContourGraph points={accurateContour} notes={notes ?? []} height={240} />
            </section>
          )}

          {notes && notes.length > 0 && (
            <section className="coach-panel p-4">
              <h2 className="font-display mb-4 text-lg italic text-[var(--ink)]">
                Notes sung{" "}
                <span className="font-body text-xs not-italic text-[var(--ink-dim)]">· {notes.length}</span>
              </h2>
              <div className="flex flex-wrap gap-3">
                {notes.map((n, i) => {
                  const col = centsColor(n.cents_offset);
                  return (
                    <div
                      key={i}
                      className="flex min-w-[58px] flex-col items-center rounded-xl border border-[var(--hairline)] bg-white/[0.03] px-3 py-2"
                      title={`${midiToSwara(n.midi).lat} · ${n.start.toFixed(2)}s–${n.end.toFixed(2)}s`}
                    >
                      <SwaraLabel midi={n.midi} size={26} color={col} />
                      <span className="font-body mt-1 text-[0.7rem] tabular-nums" style={{ color: col }}>
                        {n.cents_offset > 0 ? "+" : ""}
                        {n.cents_offset}¢
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div></main>
  );
}
