"use client";

import { UserButton, SignInButton, useAuth } from "@clerk/nextjs";

interface HeaderProps {
  songTitle?: string | null;
  sessionId?: string;
  showNewTrack?: boolean;
}

export function Header({ songTitle, sessionId, showNewTrack }: HeaderProps) {
  const { isSignedIn } = useAuth();

  return (
    <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto w-full relative z-10">
      {/* Left: Logo / Home */}
      <div className="flex items-center gap-4">
        <a
          href="/app"
          className="text-lg text-warm-200 hover:text-warm-100 transition-colors"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Stem Studio
        </a>
        {songTitle && (
          <>
            <span className="text-warm-800">/</span>
            <span className="text-sm text-warm-500 truncate max-w-xs">
              {songTitle}
            </span>
          </>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-4">
        {showNewTrack && (
          <a
            href="/app"
            className="px-3.5 py-1.5 border border-console-border hover:border-warm-600 rounded-lg text-[11px] text-warm-400 tracking-wide transition-colors btn-press"
          >
            New Track
          </a>
        )}
        {sessionId && (
          <span
            className="text-[10px] tracking-[0.15em] text-warm-700 hidden sm:inline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {sessionId.toUpperCase()}
          </span>
        )}

        {isSignedIn ? (
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-8 h-8",
              },
            }}
          />
        ) : (
          <SignInButton mode="modal"><button className="px-3.5 py-1.5 bg-console-raised border border-console-border hover:border-warm-600 rounded-lg text-[11px] text-warm-300 tracking-wide transition-colors btn-press">Sign In</button></SignInButton>
        )}
      </div>
    </header>
  );
}
