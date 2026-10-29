"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CURRICULUM, TRADITIONS, type TraditionKey } from "@/lib/curriculum";
import { getMastery, getTradition, setTradition, unlockedSet, type Mastery } from "@/lib/progress";

export default function LearnPage() {
  const [tradition, setTrad] = useState<TraditionKey>("hindustani");
  const [mastery, setMastery] = useState<Record<string, Mastery>>({});
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    // hydrate from localStorage on mount (client-only state)
    /* eslint-disable react-hooks/set-state-in-effect */
    const t = getTradition();
    setTrad(t);
    setMastery(getMastery());
    setUnlocked(unlockedSet(t));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const switchTradition = (t: TraditionKey) => {
    setTradition(t);
    setTrad(t);
    setUnlocked(unlockedSet(t));
  };

  const lessons = CURRICULUM[tradition];

  return (
    <main className="coach-page">
      <div className="workspace flex max-w-5xl flex-col gap-8">
      <header>
        <p className="workspace-eyebrow">Guided practice</p>
        <h1 className="workspace-title">Build a voice you can trust.</h1>
        <p className="workspace-copy">A deliberate sequence of small wins. Pass an exercise to open the next one.</p>
      </header>

      {/* tradition switcher */}
      <div className="flex w-fit max-w-full overflow-x-auto rounded-lg border border-[var(--hairline)] bg-black/[0.025] p-1 text-sm">
        {(Object.keys(TRADITIONS) as TraditionKey[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTradition(t)}
            className={`rounded-full px-4 py-1.5 font-body transition-colors ${
              tradition === t ? "bg-[var(--saffron)]/15 text-[var(--saffron)]" : "text-[var(--ink-dim)]"
            }`}
          >
            {TRADITIONS[t].name}
          </button>
        ))}
      </div>

      {/* lesson ladder */}
      <div className="flex flex-col gap-6">
        {lessons.map((lesson, li) => (
          <section key={lesson.id} className="coach-panel p-5 sm:p-6">
            <div className="mb-3 flex items-baseline gap-3">
              <span className="font-display text-2xl italic text-[var(--saffron)]/70">{li + 1}</span>
              <div>
                <h2 className="font-display text-lg italic">{lesson.title}</h2>
                <p className="font-body text-xs text-[var(--ink-dim)]">{lesson.about}</p>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-[var(--hairline)]">
              {lesson.exercises.map((ex) => {
                const m = mastery[ex.id];
                const open = unlocked.has(ex.id);
                const inner = (
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="font-body text-sm text-[var(--ink)]">{ex.title}</span>
                      {m?.passed && <span className="text-xs text-[var(--saffron)]">✓ {m.best}</span>}
                      {!m?.passed && m && <span className="text-xs text-[var(--ink-dim)]">best {m.best}</span>}
                    </div>
                    {open ? (
                      <span className="font-body text-xs text-[var(--saffron)]">{m?.passed ? "practice →" : "start →"}</span>
                    ) : (
                      <span className="font-body text-xs text-[var(--ink-dim)]/60">🔒 locked</span>
                    )}
                  </div>
                );
                return open ? (
                  <Link key={ex.id} href={`/practice/exercise?id=${ex.id}`} className="transition-colors hover:text-[var(--saffron)]">
                    {inner}
                  </Link>
                ) : (
                  <div key={ex.id} className="opacity-50">{inner}</div>
                );
              })}
            </div>
          </section>
        ))}
      </div></div>
    </main>
  );
}
