"use client";

import Link from "next/link";

interface HeaderProps {
  songTitle?: string | null;
  sessionId?: string;
  showNewTrack?: boolean;
}

// Studio context sub-bar. Global nav (logo, sections) is provided by <AppNav>.
export function Header({ songTitle, sessionId, showNewTrack }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 w-full relative z-10">
      {/* Left: Studio breadcrumb */}
      <div className="flex items-center gap-4">
        <Link
          href="/studio"
          className="text-lg text-warm-200 hover:text-warm-100 transition-colors"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Studio
        </Link>
        {songTitle && (
          <>
            <span className="text-warm-800">/</span>
            <span className="text-sm text-warm-500 truncate max-w-xs">{songTitle}</span>
          </>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-4">
        {showNewTrack && (
          <Link
            href="/studio"
            className="px-3.5 py-1.5 border border-console-border hover:border-warm-600 rounded-lg text-[11px] text-warm-400 tracking-wide transition-colors btn-press"
          >
            New track
          </Link>
        )}
        {sessionId && (
          <span
            className="text-[10px] tracking-[0.15em] text-warm-700 hidden sm:inline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {sessionId.toUpperCase()}
          </span>
        )}
      </div>
    </header>
  );
}
