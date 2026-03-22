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
  const animFrameRef = useRef<number>(0);

  // Initialize engine
  useEffect(() => {
    const engine = createEngine();
    engineRef.current = engine;
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      destroyEngine(engine);
      engineRef.current = null;
    };
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

  // Animation frame for time updates
  const updateTime = useCallback(() => {
    const engine = engineRef.current;
    if (engine && engine.isPlaying) {
      const t = getCurrentTime(engine);
      setCurrentTime(t);
      if (t >= engine.duration) {
        engineStop(engine);
        setIsPlaying(false);
        setCurrentTime(0);
      } else {
        animFrameRef.current = requestAnimationFrame(updateTime);
      }
    }
  }, []);

  const play = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.context.state === "suspended") {
      engine.context.resume();
    }
    enginePlay(engine);
    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame(updateTime);
  }, [updateTime]);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    enginePause(engine);
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    setCurrentTime(getCurrentTime(engine));
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engineStop(engine);
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    setCurrentTime(0);
  }, []);

  const seekTo = useCallback(
    (time: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      engineSeek(engine, time);
      setCurrentTime(time);
      if (engine.isPlaying) {
        animFrameRef.current = requestAnimationFrame(updateTime);
      }
    },
    [updateTime]
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
