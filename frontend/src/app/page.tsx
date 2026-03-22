import Link from "next/link";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Show } from "@clerk/nextjs";

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col relative overflow-hidden">
      {/* Background warmth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 20%, rgba(200, 149, 108, 0.06) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 80% 80%, rgba(124, 142, 166, 0.04) 0%, transparent 50%)",
        }}
      />

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 relative z-10">
        <span
          className="text-lg text-warm-200"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Karaoke Maker
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/app"
            className="text-sm text-warm-400 hover:text-warm-200 transition-colors"
          >
            Open Studio
          </Link>
          <Show when="signed-out">
            <SignInButton mode="modal"><button className="px-4 py-2 bg-console-raised border border-console-border hover:border-warm-600 rounded-lg text-sm text-warm-300 transition-colors btn-press">Sign In</button></SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pb-24 relative">
        <div className="text-center max-w-2xl mx-auto space-y-8 animate-fade-up">
          <p
            className="text-[11px] tracking-[0.4em] uppercase text-warm-500"
          >
            AI-Powered Karaoke Studio
          </p>

          <h1
            className="text-5xl md:text-7xl tracking-tight text-warm-100 leading-[1.1]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Remove vocals.
            <br />
            <span className="text-warm-400">Sing your heart out.</span>
          </h1>

          <p className="text-warm-500 text-lg max-w-md mx-auto leading-relaxed">
            Search any song. AI strips the vocals in seconds.
            Get a clean instrumental track — or remix stems however you want.
          </p>

          <div className="pt-4">
            <Link
              href="/app"
              className="inline-block px-8 py-3.5 rounded-lg text-sm tracking-wide transition-all btn-press border"
              style={{
                backgroundColor: "var(--color-amber-accent)",
                borderColor: "var(--color-amber-glow)",
                color: "var(--color-warm-950)",
                fontWeight: 500,
              }}
            >
              Get Started
            </Link>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto mt-24 w-full animate-fade-up delay-3">
          <FeatureCard
            title="Search Any Song"
            description="Find any track on YouTube. AI strips the vocals and isolates drums, bass, and instruments."
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
          <FeatureCard
            title="Karaoke Ready"
            description="Mute the vocals for instant karaoke. Or solo them to learn lyrics and melodies."
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            }
          />
          <FeatureCard
            title="Export & Share"
            description="Download your instrumental as WAV. Mix stems however you want — your track, your rules."
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-6 flex items-center justify-between text-[10px] text-warm-700 relative z-10">
        <span>Powered by Meta Demucs &middot; Built with Next.js + FastAPI</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>2026</span>
      </footer>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl bg-console border border-console-border space-y-3">
      <div className="text-warm-400">{icon}</div>
      <h3
        className="text-sm text-warm-200"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {title}
      </h3>
      <p className="text-xs text-warm-600 leading-relaxed">{description}</p>
    </div>
  );
}
