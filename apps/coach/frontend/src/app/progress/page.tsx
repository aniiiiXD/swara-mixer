export default function ProgressPage() {
  return (
    <main className="coach-page">
      <div className="workspace max-w-5xl">
        <p className="workspace-eyebrow">Your practice</p>
        <h1 className="workspace-title">Progress that will mean something.</h1>
        <p className="workspace-copy">Tonic will turn your takes into range, consistency, and pitch-trend insights once saved practice history is connected.</p>
        <section className="coach-panel mt-10 grid gap-px overflow-hidden bg-[var(--hairline)] sm:grid-cols-3">
          {[["Range", "Your comfortable working notes"], ["Consistency", "How steadily you land them"], ["Focus", "The next useful thing to practise"]].map(([title, copy]) => <div key={title} className="bg-[var(--night)] p-6"><p className="font-mono text-[0.65rem] uppercase tracking-[.14em] text-[var(--saffron)]">Coming with saved takes</p><h2 className="mt-5 font-body text-xl font-semibold tracking-[-.04em]">{title}</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-dim)]">{copy}</p></div>)}
        </section>
      </div>
    </main>
  );
}
