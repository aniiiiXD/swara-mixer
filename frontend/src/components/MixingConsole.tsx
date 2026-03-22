"use client";

import { useCallback, useEffect, useState } from "react";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { StemName, STEM_NAMES, MixState, StemState, defaultMixState } from "@/types";
import { StemTrack } from "./StemTrack";
import { TransportBar } from "./TransportBar";
import { ExportButton } from "./ExportButton";

export function MixingConsole({ jobId, songTitle }: { jobId: string; songTitle?: string | null }) {
  const {
    isPlaying,
    currentTime,
    duration,
    loading,
    loaded,
    play,
    pause,
    stop,
    seekTo,
    updateMix,
    setMasterVolume,
    getAudioBuffer,
  } = useAudioEngine(jobId);

  const [mixState, setMixState] = useState<MixState>(defaultMixState());
  const [masterVol, setMasterVol] = useState(1.0);

  useEffect(() => {
    updateMix(mixState);
  }, [mixState, updateMix]);

  const handleStemChange = useCallback(
    (stem: StemName, update: Partial<StemState>) => {
      setMixState((prev) => ({
        ...prev,
        [stem]: { ...prev[stem], ...update },
      }));
    },
    []
  );

  const handleMasterVolume = useCallback(
    (v: number) => {
      setMasterVol(v);
      setMasterVolume(v);
    },
    [setMasterVolume]
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          isPlaying ? pause() : play();
          break;
        case "Escape":
          stop();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isPlaying, play, pause, stop]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="w-8 h-8 border border-warm-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-warm-600 text-xs tracking-wide">Loading stems</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="text-center py-20 text-warm-700 text-sm">
        Waiting for stems...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-6xl mx-auto">
      {/* Song title + controls */}
      {songTitle && (
        <div className="mb-2">
          <h2
            className="text-lg text-warm-200 truncate"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {songTitle}
          </h2>
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-baseline gap-3">
          <h3
            className="text-sm text-warm-400"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Console
          </h3>
          <span
            className="text-[9px] text-warm-700 tracking-[0.15em]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            4 STEMS
          </span>
        </div>
        <ExportButton jobId={jobId} mixState={mixState} />
      </div>

      {/* Transport */}
      <TransportBar
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        masterVolume={masterVol}
        onPlay={play}
        onPause={pause}
        onStop={stop}
        onSeek={seekTo}
        onMasterVolumeChange={handleMasterVolume}
      />

      {/* Stem tracks */}
      <div className="flex flex-col gap-2">
        {STEM_NAMES.map((name, i) => (
          <div key={name} className={`animate-fade-up delay-${i + 1}`}>
            <StemTrack
              name={name}
              state={mixState[name]}
              currentTime={currentTime}
              duration={duration}
              audioBuffer={getAudioBuffer(name)}
              onStateChange={(update) => handleStemChange(name, update)}
            />
          </div>
        ))}
      </div>

      {/* Shortcuts hint */}
      <div
        className="flex justify-center gap-6 text-[9px] text-warm-700 tracking-[0.15em] uppercase pt-3"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span>Space — Play/Pause</span>
        <span>Esc — Stop</span>
      </div>
    </div>
  );
}
