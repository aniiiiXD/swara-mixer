"use client";

import { useEffect, useRef } from "react";
import type { Caption } from "@/lib/api";

export function KaraokeDisplay({
  captions,
  currentTime,
}: {
  captions: Caption[];
  currentTime: number;
}) {
  const activeIndex = captions.findLastIndex((c) => currentTime >= c.start && currentTime <= c.end);
  const upcomingIndex = activeIndex === -1
    ? captions.findIndex((c) => c.start > currentTime)
    : -1;

  const prevCue = activeIndex > 0 ? captions[activeIndex - 1] : null;
  const activeCue = activeIndex >= 0 ? captions[activeIndex] : null;
  const nextCue = activeIndex >= 0 && activeIndex < captions.length - 1
    ? captions[activeIndex + 1]
    : upcomingIndex >= 0
    ? captions[upcomingIndex]
    : null;

  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll active line into view
  useEffect(() => {
    const el = containerRef.current?.querySelector("[data-active]");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (captions.length === 0) return null;

  return (
    <div
      className="w-full rounded-lg border border-console-border bg-console px-6 py-4 overflow-hidden"
      style={{ minHeight: "5.5rem" }}
    >
      <div ref={containerRef} className="flex flex-col items-center gap-1 text-center">
        {prevCue && (
          <p
            className="text-sm text-warm-700 transition-all duration-300 truncate w-full"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {prevCue.text}
          </p>
        )}

        <p
          data-active={activeCue ? "" : undefined}
          className={`text-base transition-all duration-300 truncate w-full ${
            activeCue
              ? "text-warm-200 scale-105"
              : "text-warm-600"
          }`}
          style={{
            fontFamily: "var(--font-serif)",
            transform: activeCue ? "scale(1.03)" : "scale(1)",
          }}
        >
          {activeCue?.text ?? nextCue?.text ?? "♪"}
        </p>

        {activeCue && nextCue && (
          <p
            className="text-sm text-warm-700 transition-all duration-300 truncate w-full"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {nextCue.text}
          </p>
        )}
      </div>
    </div>
  );
}
