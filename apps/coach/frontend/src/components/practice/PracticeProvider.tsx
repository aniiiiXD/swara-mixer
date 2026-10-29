"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { karaokeUrl, vocalStemUrl } from "@/lib/songApi";
import { usePracticeState } from "@/hooks/usePracticeState";
export const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

type PracticeState = ReturnType<typeof usePracticeState>;
const Context = createContext<PracticeState | null>(null);
export function usePractice() { const value = useContext(Context); if (!value) throw new Error("PracticeProvider missing"); return value; }

export default function PracticeProvider({ children }: { children: React.ReactNode }) {
  const { backing, vocal, ...p } = usePracticeState();
  return <Context.Provider value={{ ...p, backing, vocal }}>
    <audio ref={backing} src={p.song ? karaokeUrl(p.song.jobId) : undefined} preload="auto" onLoadedMetadata={e => { e.currentTarget.playbackRate = p.speed; }} onTimeUpdate={p.onTimeUpdate} onEnded={p.pause} onError={() => { if (p.playing) p.pause(); }} />
    <audio ref={vocal} src={p.song ? vocalStemUrl(p.song.jobId) : undefined} preload="auto" onLoadedMetadata={e => { e.currentTarget.playbackRate = p.speed; }} />
    {children}
    {p.song && <footer className="practice-player" aria-label="Global song player">
      <div className="practice-player__track"><span className="practice-kicker">Now playing</span><Link href={`/songs/view?id=${p.song.jobId}`}>{p.song.title}</Link></div>
      <div className="practice-player__transport">
        <div className="practice-player__buttons">
          <button onClick={() => p.seek(p.getTime() - 5)} aria-label="Back 5 seconds">−5s</button>
          <button className="practice-play" onClick={p.playing || p.starting ? p.pause : p.play} disabled={p.loading} aria-label={p.playing ? "Pause song" : p.starting ? "Cancel playback" : "Play song"}>{p.playing ? "Pause" : p.starting ? "Cancel" : "Play"}</button>
          <button onClick={() => p.seek(p.getTime() + 5)} aria-label="Forward 5 seconds">+5s</button>
          <button aria-pressed={p.micOn} disabled={p.micStarting} onClick={() => p.micOn ? void p.stopMic() : void p.startMic()}>{p.micStarting ? "Connecting mic…" : p.micOn ? "Mic on" : "Enable mic"}</button>
        </div>
        <div className="practice-scrub"><time>{formatTime(p.time)}</time><input type="range" aria-label="Song position" min={0} max={p.duration || 1} step={.01} value={p.time} onChange={e => p.seek(Number(e.target.value))} /><time>{formatTime(p.duration)}</time></div>
      </div>
      <label className="practice-player__volume">Volume <input type="range" aria-label="Master volume" min={0} max={1} step={.01} value={p.volume} onChange={e => p.setVolume(Number(e.target.value))} /></label>
    </footer>}
  </Context.Provider>;
}
