"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PracticeGraph from "@/components/PracticeGraph";
import { karaokeUrl, vocalStemUrl, type Reference } from "@/lib/songApi";
import type { PitchSample } from "@/lib/pitch";

type Source = "original" | "vocal" | "instrumental";

const SOURCES: { k: Source; label: string; hint: string }[] = [
  { k: "original", label: "🎼 Original", hint: "full song — vocal + backing" },
  { k: "vocal", label: "🎤 Vocal only", hint: "the isolated singer" },
  { k: "instrumental", label: "🎸 Instrumental", hint: "backing only" },
];

/**
 * Passive "listen" mode: play the song (or just the isolated vocal), watch the
 * pitch contour scroll under a now-line. The reference itself is the learning
 * instrument, so there is no separate piano representation to distract from it.
 */
export default function SongListen({ jobId, reference }: { jobId: string; reference: Reference }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const emptySamples = useRef<PitchSample[]>([]); // no mic in listen mode
  const playingRef = useRef(false); // survives src swaps, unlike audio.paused

  const [source, setSource] = useState<Source>("original");
  const [playing, setPlaying] = useState(false);

  const notes = reference.notes;
  const src = source === "vocal" ? vocalStemUrl(jobId) : karaokeUrl(jobId, source === "original");

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    await audio.play();
    playingRef.current = true;
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = false;
    setPlaying(false);
  }, []);

  // switching source keeps the current position (and resumes if it was playing)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime;
    const wasPlaying = playingRef.current;
    const onLoaded = () => {
      try {
        audio.currentTime = t;
      } catch {
        /* pre-metadata seek can throw; ignore */
      }
      if (wasPlaying) void audio.play();
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.load();
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      playingRef.current = false;
      setPlaying(false);
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <audio ref={audioRef} src={src} preload="auto" />

      <div className="h-[340px] w-full">
        <PracticeGraph
          reference={reference.contour}
          notes={notes}
          samplesRef={emptySamples}
          getTime={getTime}
          playing={playing}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={playing ? pause : play}
          className={`flex h-12 items-center gap-2 rounded-full border px-6 font-body text-sm transition-colors ${
            playing
              ? "border-[var(--vermillion)] bg-[var(--vermillion)]/15 text-[var(--vermillion)]"
              : "border-[var(--hairline)] bg-white/5 text-[var(--ink)] hover:border-[var(--saffron)] hover:bg-[var(--saffron)]/10"
          }`}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <div className="flex rounded-full border border-[var(--hairline)] bg-white/[0.03] p-1 text-sm">
          {SOURCES.map((o) => (
            <button
              key={o.k}
              onClick={() => setSource(o.k)}
              title={o.hint}
              className={`rounded-full px-3 py-1.5 font-body transition-colors ${
                source === o.k ? "bg-[var(--saffron)]/15 text-[var(--saffron)]" : "text-[var(--ink-dim)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <p className="font-body text-center text-xs text-[var(--ink-dim)]">
        {source === "vocal"
          ? "hearing just the isolated singer"
          : source === "instrumental"
            ? "backing track only"
            : "full mix"}{" "}
        · follow the reference contour as the phrase moves
      </p>
    </div>
  );
}
