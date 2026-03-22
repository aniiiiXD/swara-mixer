"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioEngine,
  createEngine,
  loadStem,
  play as enginePlay,
  pause as enginePause,
  stop as engineStop,
  seek as engineSeek,
  getCurrentTime,
  applyMixState,
  setMasterGain,
  destroyEngine,
} from "@/lib/audioEngine";
import { StemName, STEM_NAMES, MixState } from "@/types";
import { getStemUrl } from "@/lib/api";

export function useAudioEngine(jobId: string | null) {
  const engineRef = useRef<AudioEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const playingRef = useRef(false);
  const animFrameRef = useRef<number>(0);

  // Initialize engine
  useEffect(() => {
    const engine = createEngine();
    engineRef.current = engine;
    return () => {
      playingRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      destroyEngine(engine);
      engineRef.current = null;
    };
  }, []);

  // Persistent animation loop — reads from ref, not state
  const tick = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !playingRef.current) return;

    const t = getCurrentTime(engine);
    if (t >= engine.duration) {
      engineStop(engine);
      playingRef.current = false;
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    setCurrentTime(t);
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // Load stems when jobId is set
  useEffect(() => {
    if (!jobId || !engineRef.current) return;
    const engine = engineRef.current;

    setLoading(true);
    Promise.all(
      STEM_NAMES.map((name) => loadStem(engine, name, getStemUrl(jobId, name)))
    )
      .then(() => {
        setDuration(engine.duration);
        setLoaded(true);
      })
      .catch((err) => console.error("Failed to load stems:", err))
      .finally(() => setLoading(false));
  }, [jobId]);

  const play = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || playingRef.current) return;
    if (engine.context.state === "suspended") {
      engine.context.resume();
    }
    enginePlay(engine);
    playingRef.current = true;
    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !playingRef.current) return;
    enginePause(engine);
    playingRef.current = false;
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    setCurrentTime(getCurrentTime(engine));
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engineStop(engine);
    playingRef.current = false;
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    setCurrentTime(0);
  }, []);

  const seekTo = useCallback(
    (time: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const wasPlaying = playingRef.current;
      engineSeek(engine, time);
      setCurrentTime(time);
      if (wasPlaying && playingRef.current) {
        // engineSeek pauses + plays internally, restart the tick loop
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(tick);
      }
    },
    [tick]
  );

  const updateMix = useCallback((mixState: MixState) => {
    const engine = engineRef.current;
    if (!engine) return;
    applyMixState(engine, mixState);
  }, []);

  const setMasterVolume = useCallback((value: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    setMasterGain(engine, value);
  }, []);

  const getAnalyserData = useCallback((): Uint8Array | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    const data = new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getByteFrequencyData(data);
    return data;
  }, []);

  const getAudioBuffer = useCallback((stem: StemName): AudioBuffer | null => {
    return engineRef.current?.stems[stem].buffer ?? null;
  }, []);

  return {
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
    getAnalyserData,
    getAudioBuffer,
  };
}
