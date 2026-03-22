"use client";

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

  return (
    <div className="flex items-center gap-5 px-5 py-3 bg-console border border-console-border rounded-lg console-raised">
      {/* Transport controls */}
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

      {/* Time */}
      <div
        className="w-24 text-center text-xs text-warm-400"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span className="text-warm-200">{formatTime(currentTime)}</span>
        <span className="text-warm-700"> / </span>
        <span className="text-warm-500">{formatTime(duration)}</span>
      </div>

      {/* Seek bar */}
      <div className="flex-1 relative group">
        <div className="h-1 bg-console-surface rounded-full overflow-hidden console-groove">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${progress}%`,
              backgroundColor: "var(--color-amber-accent)",
              opacity: 0.7,
            }}
          />
        </div>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>

      {/* Master volume */}
      <div className="flex items-center gap-2.5 w-28">
        <span
          className="text-[8px] tracking-[0.15em] text-warm-600"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          MSTR
        </span>
        <div className="flex-1 relative">
          <div className="h-1 bg-console-surface rounded-full overflow-hidden console-groove">
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
  );
}
