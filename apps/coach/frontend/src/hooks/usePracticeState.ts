"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveDetector, type PitchSample } from "@/lib/pitch";
import { getReference, getSong, scoreTake, type Reference, type SongInfo, type Score } from "@/lib/songApi";

export type MicSettings = { gain: number; gateDb: number; clarity: number; smoothing: number; minHz: number; maxHz: number; latencyMs: number };
const defaultSettings: MicSettings = { gain: 1, gateDb: -54, clarity: .78, smoothing: 3, minHz: 55, maxHz: 1100, latencyMs: 80 };
export function usePracticeState() {
  const backing = useRef<HTMLAudioElement>(null);
  const vocal = useRef<HTMLAudioElement>(null);
  const detector = useRef<LiveDetector | null>(null);
  const samples = useRef<PitchSample[]>([]);
  const live = useRef<PitchSample | null>(null);
  const request = useRef(0);
  const selected = useRef<string | null>(null);
  const playRequest = useRef(0);
  const settingsRef = useRef(defaultSettings);
  const [song, setSong] = useState<SongInfo | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [volume, setVolume] = useState(.75);
  const [backingLevel, setBackingLevel] = useState(1);
  const [vocalLevel, setVocalLevel] = useState(1);
  const [micOn, setMicOn] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettingsState] = useState(defaultSettings);
  const [meter, setMeter] = useState<PitchSample | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreReady, setScoreReady] = useState(true);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const duration = reference?.duration ?? song?.duration ?? 0;
  const getTime = useCallback(() => backing.current?.currentTime ?? 0, []);

  const pause = useCallback(() => {
    playRequest.current++;
    backing.current?.pause(); vocal.current?.pause();
    detector.current?.setRecordingPaused(true);
    setStarting(false); setPlaying(false);
  }, []);

  const stopMic = useCallback(async () => {
    const det = detector.current; detector.current = null;
    setMicOn(false); setMicStarting(false); live.current = null; setMeter(null);
    return await det?.stop() ?? null;
  }, []);

  const selectSong = useCallback(async (id: string) => {
    if (selected.current === id) return;
    selected.current = id;
    const generation = ++request.current;
    pause(); void stopMic(); samples.current = [];
    setReference(null); setScore(null); setLoading(true); setError(null); setTime(0);
    setLoopOn(false); setLoopA(null); setLoopB(null);
    try {
      const [nextSong, nextReference] = await Promise.all([getSong(id), getReference(id)]);
      if (generation !== request.current) return;
      setSong(nextSong); setReference(nextReference);
    } catch (e) {
      if (generation === request.current) { selected.current = null; setError(String(e)); }
    } finally { if (generation === request.current) setLoading(false); }
  }, [pause, stopMic]);

  const play = useCallback(async () => {
    const a = backing.current, v = vocal.current;
    if (!a || !v || !reference || starting) return;
    const generation = ++playRequest.current;
    setStarting(true); setError(null);
    try {
      if (a.currentTime >= duration - .05) { a.currentTime = 0; samples.current = []; }
      v.currentTime = a.currentTime;
      await Promise.all([a.play(), v.play()]);
      if (generation !== playRequest.current) return;
      v.currentTime = a.currentTime;
      detector.current?.setRecordingPaused(false);
      setPlaying(true);
    } catch (e) { if (generation === playRequest.current) { pause(); setError(`Playback failed: ${String(e)}`); } }
    finally { if (generation === playRequest.current) setStarting(false); }
  }, [reference, starting, duration, pause]);

  const seek = useCallback((next: number) => {
    const t = Math.max(0, Math.min(duration, next));
    for (const a of [backing.current, vocal.current]) if (a) a.currentTime = t;
    samples.current = []; setTime(t);
    if (detector.current) setScoreReady(false);
  }, [duration]);

  const setSpeed = (next: number) => {
    setSpeedState(next);
    for (const a of [backing.current, vocal.current]) if (a) { a.playbackRate = next; a.preservesPitch = true; }
    if (detector.current) setScoreReady(false);
  };

  const updateSettings = (patch: Partial<MicSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next; setSettingsState(next);
    detector.current?.configure({ gain: next.gain, minRms: 10 ** (next.gateDb / 20), minClarity: next.clarity, smoothingFrames: next.smoothing, minHz: next.minHz, maxHz: next.maxHz });
  };

  const startMic = async (input = deviceId) => {
    if (detector.current) return;
    setMicStarting(true); setError(null); setScore(null); samples.current = [];
    const s = settingsRef.current;
    let lastMeter = 0;
    const det = new LiveDetector({ deviceId: input, gain: s.gain, minRms: 10 ** (s.gateDb / 20), minClarity: s.clarity, smoothingFrames: s.smoothing, minHz: s.minHz, maxHz: s.maxHz,
      onSample: sample => {
        if (detector.current !== det) return;
        live.current = sample;
        const a = backing.current;
        if (a && !a.paused && !a.seeking && a.readyState >= 3) {
          const t = Math.max(0, a.currentTime - settingsRef.current.latencyMs / 1000 * a.playbackRate);
          const prev = samples.current.at(-1);
          if (prev && (t < prev.time || t - prev.time > .25)) samples.current.push({ ...sample, time: t, midi: null, hz: null });
          if (!prev || t > prev.time) samples.current.push({ ...sample, time: t });
          if (samples.current.length > 3600) samples.current.splice(0, 900);
        }
        if (performance.now() - lastMeter > 120) { lastMeter = performance.now(); setMeter(sample); }
      }
    });
    detector.current = det;
    try {
      await det.start();
      if (detector.current !== det) { await det.stop(); return; }
      det.setRecordingPaused(backing.current?.paused ?? true);
      setMicOn(true); setScoreReady(speed === 1);
      void navigator.mediaDevices.enumerateDevices().then(ds => setDevices(ds.filter(d => d.kind === "audioinput"))).catch(() => {});
    } catch (e) { if (detector.current === det) detector.current = null; setError(`Microphone: ${String(e)}`); }
    finally { setMicStarting(false); }
  };

  const changeDevice = async (id: string) => {
    const active = !!detector.current;
    await stopMic(); setDeviceId(id);
    if (active) await startMic(id);
  };

  const finishAndScore = async () => {
    if (!song || !scoreReady || scoring) return;
    const id = song.jobId, generation = request.current;
    setScoring(true);
    try {
      const clip = await stopMic();
      if (!clip) return;
      const result = await scoreTake(id, clip);
      if (generation === request.current) setScore(result.score);
    } catch (e) { setError(`Scoring failed: ${String(e)}`); }
    finally { setScoring(false); }
  };

  const onTimeUpdate = () => {
    const a = backing.current, v = vocal.current;
    if (!a) return;
    if (loopOn && loopA !== null && loopB !== null && a.currentTime >= loopB) { seek(loopA); return; }
    setTime(a.currentTime);
    if (v && !a.paused && Math.abs(v.currentTime - a.currentTime) > .12) v.currentTime = a.currentTime;
  };

  useEffect(() => {
    if (backing.current) backing.current.volume = volume * backingLevel;
    if (vocal.current) vocal.current.volume = volume * vocalLevel;
  }, [volume, backingLevel, vocalLevel, song]);
  useEffect(() => {
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(ds => setDevices(ds.filter(d => d.kind === "audioinput"))).catch(() => {}); };
    refresh(); navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      // These are request generation counters, not DOM nodes; invalidate the latest requests.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playRequest.current++;
      const det = detector.current; detector.current = null; void det?.stop();
    };
  }, []);

  return { backing, vocal, samples, live, song, reference, loading, error, playing, starting, time, duration, speed, volume, backingLevel, vocalLevel, micOn, micStarting, settings, meter, devices, deviceId, score, scoring, scoreReady, loopA, loopB, loopOn,
    selectSong, play, pause, seek, getTime, setSpeed, setVolume, setBackingLevel, setVocalLevel, updateSettings, startMic, stopMic, changeDevice, finishAndScore, onTimeUpdate, setLoopA, setLoopB, setLoopOn };
}

