import Link from "next/link";

const PATHS = [
  {
    k: "01 · Coach",
    title: "Hear your voice clearly",
    body: "Live pitch, guided exercises, and feedback that helps you improve without turning practice into a dashboard.",
    href: "/today",
  },
  {
    k: "02 · Mix",
    title: "Make any song workable",
    body: "Prepare a track into stems, shape the balance, then keep the song close while you learn it.",
    href: "/mix",
  },
  {
    k: "03 · Pitch",
    title: "Read the musical line",
    body: "Inspect a reference vocal as a contour, a phrase, and a set of notes you can return to in practice.",
    href: "/pitch",
  },
];

export default function Landing() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--studio-base)]">
      {/* slow halo */}
      <div
        aria-hidden
        className="drift pointer-events-none fixed left-1/2 top-1/2 -z-10 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.05]"
        style={{
          background:
            "repeating-conic-gradient(from 0deg, transparent 0deg, transparent 8deg, rgba(244,183,64,0.6) 8.4deg, transparent 8.8deg)",
        }}
      />

      {/* top bar */}
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
        <span className="inline-flex items-center gap-2 font-body text-lg font-semibold tracking-[-.05em] text-[var(--ink)]"><span className="text-[var(--saffron)]">◒</span>Tonic</span>
        <Link
          href="/today"
          className="font-body rounded-full border border-[var(--hairline)] px-4 py-1.5 text-sm text-[var(--ink-dim)] transition-colors hover:border-[var(--saffron)] hover:text-[var(--saffron)]"
        >
          Open app
        </Link>
      </div>

      {/* hero */}
      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-10 px-6 py-16 sm:px-10 lg:grid-cols-[1.2fr_.8fr] lg:items-end lg:py-28">
        <div>
        <p className="rise font-body text-[0.7rem] uppercase tracking-[0.5em] text-[var(--marigold)]">
          One voice · three workspaces
        </p>
        <h1
          className="rise mt-4 max-w-[10ch] font-body text-6xl font-semibold leading-[.9] tracking-[-.075em] sm:text-8xl"
          style={{ animationDelay: "60ms" }}
        >
          A better place to work on your <span className="text-[var(--saffron)]">voice.</span>
        </h1>
        <p
          className="rise font-body mt-7 max-w-lg text-base leading-7 text-[var(--ink-dim)] sm:text-lg"
          style={{ animationDelay: "140ms" }}
        >
          A focused Coach for practice, a proper Mix studio for songs, and a Pitch canvas for hearing what a melody actually does.
        </p>
        <div className="rise mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "220ms" }}>
          <Link
            href="/today"
            className="font-body rounded-full bg-[var(--saffron)] px-7 py-3 font-medium text-neutral-950 shadow-[0_0_30px_-4px_var(--saffron)] transition-colors hover:bg-[var(--marigold)]"
          >
            Start singing
          </Link>
          <Link
            href="/songs"
            className="font-body rounded-full border border-[var(--hairline)] px-7 py-3 text-[var(--ink)] transition-colors hover:border-[var(--saffron)]"
          >
            Explore songs
          </Link>
        </div></div>
        <div className="rise border-l border-[var(--hairline)] pl-6 sm:pl-10" style={{ animationDelay: "250ms" }}>
          <p className="font-mono text-[.65rem] uppercase tracking-[.16em] text-[var(--ink-dim)]">Built around the work</p>
          <div className="mt-8 flex flex-col gap-5">{["Coach is warm and clear.", "Mix stays quiet and technical.", "Pitch makes the invisible visible."].map((line, index) => <p key={line} className="font-body text-xl leading-tight tracking-[-.035em] text-[var(--ink)]"><span className="mr-3 font-mono text-xs text-[var(--saffron)]">0{index + 1}</span>{line}</p>)}</div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl grid-cols-1 border-t border-[var(--hairline)] px-6 sm:grid-cols-3 sm:px-10">
        {PATHS.map((f, i) => (
          <Link
            key={f.k}
            href={f.href}
            className="rise group flex min-h-64 flex-col justify-between border-b border-[var(--hairline)] py-8 sm:border-b-0 sm:px-8 sm:py-10 [&:not(:last-child)]:sm:border-r"
            style={{ animationDelay: `${300 + i * 80}ms` }}
          >
            <span className="font-body text-[0.65rem] uppercase tracking-[0.3em] text-[var(--marigold)]">
              {f.k}
            </span>
            <div><h3 className="mt-4 font-body text-2xl font-semibold tracking-[-.05em] text-[var(--ink)] group-hover:text-[var(--saffron)]">{f.title}</h3><p className="mt-3 font-body text-sm leading-relaxed text-[var(--ink-dim)]">{f.body}</p></div>
            <span className="mt-8 font-mono text-xs uppercase tracking-[.15em] text-[var(--saffron)]">Open workspace ↗</span>
          </Link>
        ))}
      </section>

      <footer className="font-body pb-8 text-center text-xs text-[var(--ink-dim)]">
        Tonic — listen, practice, improve.
      </footer>
    </main>
  );
}
