"use client";

import { useRef, useCallback } from "react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TransportBar({
  isPlaying,
  currentTime,
  duration,
  masterVolume,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onMasterVolumeChange,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  masterVolume: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onMasterVolumeChange: (v: number) => void;
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const timelineRef = useRef<HTMLDivElement>(null);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      onSeek(pct * duration);
    },
    [duration, onSeek]
  );

  const handleTimelineDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      handleTimelineClick(e);
    },
    [handleTimelineClick]
  );

  return (
    <div className="flex flex-col gap-2 bg-console border border-console-border rounded-lg console-raised p-4">
      {/* Timeline — full width, prominent */}
      <div
        ref={timelineRef}
        className="relative h-8 cursor-pointer group"
        onClick={handleTimelineClick}
        onMouseMove={handleTimelineDrag}
      >
        {/* Track background with tick marks */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-console-surface rounded-full console-groove overflow-hidden">
          {/* Progress fill */}
          <div
            className="h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, var(--color-amber-dim), var(--color-amber-accent))",
            }}
          />
        </div>

        {/* Playhead thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full transition-[left] duration-75 group-hover:scale-125"
          style={{
            left: `${progress}%`,
            backgroundColor: "var(--color-amber-accent)",
            boxShadow: "0 0 6px rgba(200, 149, 108, 0.4)",
          }}
        />

        {/* Hover time indicator — tick marks at quarters */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <div
            key={pct}
            className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-console-border"
            style={{ left: `${pct}%` }}
          />
        ))}

        {/* Time labels at edges */}
        <span
          className="absolute -bottom-0.5 left-0 text-[9px] text-warm-700"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {formatTime(0)}
        </span>
        <span
          className="absolute -bottom-0.5 right-0 text-[9px] text-warm-700"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4">
        {/* Transport buttons */}
        <div className="flex items-center gap-1.5">
          {/* Stop */}
          <button
            onClick={onStop}
            className="w-8 h-8 rounded bg-console-surface border border-console-border hover:border-warm-600 flex items-center justify-center transition-colors btn-press"
          >
            <div className="w-2.5 h-2.5 bg-warm-600 rounded-[1px]" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all btn-press border"
            style={{
              backgroundColor: isPlaying
                ? "var(--color-amber-accent)"
                : "var(--color-console-raised)",
              borderColor: isPlaying
                ? "var(--color-amber-glow)"
                : "var(--color-console-border)",
            }}
          >
            {isPlaying ? (
              <div className="flex gap-[3px]">
                <div className="w-[3px] h-3.5 rounded-[1px]" style={{ backgroundColor: "var(--color-warm-950)" }} />
                <div className="w-[3px] h-3.5 rounded-[1px]" style={{ backgroundColor: "var(--color-warm-950)" }} />
              </div>
            ) : (
              <div
                className="w-0 h-0 ml-0.5"
                style={{
                  borderLeft: "8px solid var(--color-warm-300)",
                  borderTop: "5px solid transparent",
                  borderBottom: "5px solid transparent",
                }}
              />
            )}
          </button>
        </div>

        {/* Current time */}
        <div
          className="text-sm text-warm-200 tabular-nums min-w-[5rem]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {formatTime(currentTime)}
          <span className="text-warm-700 text-xs"> / {formatTime(duration)}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Master volume */}
        <div className="flex items-center gap-2.5 w-32">
          <span
            className="text-[8px] tracking-[0.15em] text-warm-600"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            MSTR
          </span>
          <div className="flex-1 relative h-6 flex items-center">
            <div className="w-full h-1 bg-console-surface rounded-full overflow-hidden console-groove">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${masterVolume * 100}%`,
                  backgroundColor: "var(--color-warm-500)",
                }}
              />
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={(e) => onMasterVolumeChange(parseFloat(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
