"use client";

import { useRouter } from "next/navigation";
import { YouTubeInput } from "@/components/YouTubeInput";
import { Header } from "@/components/Header";

export default function AppPage() {
  const router = useRouter();

  return (
    <main className="flex-1 flex flex-col relative overflow-hidden">
      <Header />

      {/* Subtle radial warmth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(200, 149, 108, 0.04) 0%, transparent 70%)",
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {/* Hero */}
        <div className="text-center mb-14 space-y-5 relative animate-fade-up">
          <p
            className="text-[11px] tracking-[0.35em] uppercase text-warm-500"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Karaoke Maker
          </p>
          <h1
            className="text-4xl md:text-5xl tracking-tight text-warm-100"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Pick a song
          </h1>
          <p className="text-warm-500 text-sm max-w-sm mx-auto leading-relaxed">
            Search for any track. We&apos;ll remove the vocals and give you a karaoke-ready instrumental.
          </p>
        </div>

        {/* Search */}
        <div className="w-full animate-fade-up delay-2 relative">
          <YouTubeInput
            onJobCreated={(jobId) => router.push(`/studio/${jobId}`)}
          />
        </div>
      </div>
    </main>
  );
}
