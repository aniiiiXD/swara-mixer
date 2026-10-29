"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PitchGraph from "@/components/PitchGraph";
import { LiveDetector, midiToHz, midiToName, type PitchSample } from "@/lib/pitch";
import { findExercise, flatExercises, TRADITIONS } from "@/lib/curriculum";
import { getSaHz, setSaHz, recordAttempt, PASS } from "@/lib/progress";
import { scoreExercise, saHzToMidi, type ExerciseScore } from "@/lib/exerciseScore";
import { Drone, playSequence } from "@/lib/audio";
import { API } from "@/lib/songApi";
import type { NoteSeg } from "@/components/ContourGraph";

const SA_OPTIONS = Array.from({ length: 20 }, (_, i) => 48 + i); // C3..G4

// Query param rather than a path segment: the desktop build is a static export,
// so every route must be known at build time. Same shape as /pitch?track=.
function ExerciseRunner() {
  const exerciseId = useSearchParams().get("id") ?? "";
  const found = findExercise(exerciseId);

  const samplesRef = useRef<PitchSample[]>([]);
  const detectorRef = useRef<LiveDetector | null>(null);
  const droneRef = useRef<Drone | null>(null);

  const [saMidiState, setSaMidiState] = useState(60); // C4
  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [droneOn, setDroneOn] = useState(false);
  const [playingTarget, setPlayingTarget] = useState(false);
  const [score, setScore] = useState<ExerciseScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaMidiState(Math.round(saHzToMidi(getSaHz())));
    droneRef.current = new Drone();
    return () => droneRef.current?.stop();
  }, []);

  const saHz = midiToHz(saMidiState);

  const changeSa = (midi: number) => {
    setSaMidiState(midi);
    setSaHz(midiToHz(midi));
    if (droneOn) droneRef.current?.start(midiToHz(midi));
  };

  const toggleDrone = () => {
    if (droneOn) {
      droneRef.current?.stop();
      setDroneOn(false);
    } else {
      droneRef.current?.start(saHz);
      setDroneOn(true);
    }
  };

  const target = found?.ex.target ?? [];
  const trad = found ? TRADITIONS[found.tradition] : null;

  const hearIt = async () => {
    if (!found) return;
    setPlayingTarget(true);
    await playSequence(found.ex.target, saHz, found.ex.bpm);
    setPlayingTarget(false);
  };

  const start = async () => {
    setError(null);
    setScore(null);
    samplesRef.current = [];
    const det = new LiveDetector({ onSample: (s) => samplesRef.current.push(s) });
    detectorRef.current = det;
    try {
      await det.start();
      setRunning(true);
    } catch (e) {
      setError(`mic error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stop = async () => {
    const det = detectorRef.current;
    if (!det || !found) return;
    setRunning(false);
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
      const sc = scoreExercise(found.ex.target, data.notes as NoteSeg[], saHzToMidi(saHz));
      setScore(sc);
      recordAttempt(found.ex.id, sc.overall);
    } catch (e) {
      setError(`analysis error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const order = found ? flatExercises(found.tradition) : [];
  const curIdx = order.findIndex((o) => o.ex.id === exerciseId);
  const nextId = curIdx >= 0 && curIdx + 1 < order.length ? order[curIdx + 1].ex.id : null;

  if (!found || !trad) {
    return (
      <main className="coach-page"><div className="workspace mx-auto max-w-3xl text-center">
        <p className="font-body text-[var(--ink-dim)]">Exercise not found.</p>
        <Link href="/learn" className="font-body text-sm text-[var(--saffron)]">← back to Learn</Link>
      </div></main>
    );
  }

  // collapsed target labels for display
  const labels: number[] = [];
  for (const n of target) if (labels.length === 0 || labels[labels.length - 1] !== n.deg) labels.push(n.deg);

  return (
    <main className="coach-page"><div className="workspace mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link href="/learn" className="font-body text-sm text-[var(--ink-dim)] hover:text-[var(--saffron)]">
          ← Learn
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-body text-xs text-[var(--ink-dim)]">{trad.tonicName} =</span>
          <select
            value={saMidiState}
            onChange={(e) => changeSa(Number(e.target.value))}
            className="font-body rounded-lg border border-[var(--hairline)] bg-[var(--night)] px-2 py-1 text-sm text-[var(--ink)] outline-none"
          >
            {SA_OPTIONS.map((m) => (
              <option key={m} value={m}>{midiToName(m)}</option>
            ))}
          </select>
        </div>
      </header>

      <div>
        <h1 className="font-display text-3xl italic">{found.ex.title}</h1>
        <p className="font-body mt-1 text-sm text-[var(--ink-dim)]">{found.ex.about}</p>
      </div>

      {/* target phrase */}
      <section className="coach-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-body text-xs uppercase tracking-widest text-[var(--marigold)]">Sing this</span>
          <div className="flex gap-2">
            <button
              onClick={toggleDrone}
              className={`font-body rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                droneOn ? "border-[var(--saffron)] text-[var(--saffron)]" : "border-[var(--hairline)] text-[var(--ink-dim)]"
              }`}
            >
              {droneOn ? "◉ Drone on" : "○ Drone"}
            </button>
            <button
              onClick={hearIt}
              disabled={playingTarget}
              className="font-body rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-sm text-[var(--ink-dim)] hover:border-[var(--saffron)] disabled:opacity-50"
            >
              {playingTarget ? "playing…" : "♪ Hear it"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {labels.map((deg, i) => {
            const sc = score?.targets[i];
            const col = !sc ? "var(--ink)" : sc.hit ? "var(--saffron)" : "var(--vermillion)";
            return (
              <div key={i} className="flex flex-col items-center">
                <span className="font-display text-2xl" style={{ color: col }}>{trad.degreeLabel(deg)}</span>
                {sc && (
                  <span className="font-body text-[0.65rem] tabular-nums" style={{ color: col }}>
                    {sc.sungMidi === null ? "—" : `${sc.cents! > 0 ? "+" : ""}${sc.cents}¢`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* live graph */}
      <section className="coach-panel p-3">
        <div className="h-[320px] w-full">
          <PitchGraph samplesRef={samplesRef} running={running} />
        </div>
      </section>

      {/* controls / score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={running ? stop : start}
            className={`flex h-16 w-16 items-center justify-center rounded-full border transition-all ${
              running
                ? "breathe border-[var(--vermillion)] bg-[var(--vermillion)]/15"
                : "border-[var(--hairline)] bg-white/5 hover:border-[var(--saffron)]"
            }`}
            aria-label={running ? "Stop" : "Sing"}
          >
            <span
              className={
                running
                  ? "block h-5 w-5 rounded bg-[var(--vermillion)]"
                  : "block h-6 w-6 rounded-full bg-[var(--saffron)] shadow-[0_0_20px_var(--saffron)]"
              }
            />
          </button>
          <span className="font-body text-sm text-[var(--ink-dim)]">
            {running ? "singing — tap to finish" : analyzing ? "scoring…" : "tap to sing the phrase"}
          </span>
        </div>

        {score && (
          <div className="flex items-center gap-5">
            <div className="text-right">
              <div
                className="font-display text-4xl tabular-nums"
                style={{ color: score.overall >= PASS ? "var(--saffron)" : "var(--vermillion)" }}
              >
                {score.overall}
              </div>
              <div className="font-body text-[0.65rem] uppercase tracking-widest text-[var(--ink-dim)]">
                {score.overall >= PASS ? "passed ✓" : `need ${PASS}`}
              </div>
            </div>
            {score.overall >= PASS && nextId && (
              <Link
                href={`/practice/exercise?id=${nextId}`}
                className="font-body rounded-full bg-[var(--saffron)] px-5 py-2.5 font-medium text-neutral-950 hover:bg-[var(--marigold)]"
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </div>

      {error && <p className="font-body text-sm text-[var(--vermillion)]">{error}</p>}
    </div></main>
  );
}

export default function ExercisePage() {
  return (
    <Suspense fallback={null}>
      <ExerciseRunner />
    </Suspense>
  );
}
