"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PracticeGraph from "@/components/PracticeGraph";
import { formatTime, usePractice } from "@/components/practice/PracticeProvider";
import { hzToMidi, midiToName } from "@/lib/pitch";

export default function SongPractice({ initialJobId }: { initialJobId?: string } = {}) {
  const p = usePractice();
  const { selectSong } = p;
  const [seconds, setSeconds] = useState(10);
  const [notation, setNotation] = useState<"notes" | "swaras">("notes");
  useEffect(() => { if (initialJobId) void selectSong(initialJobId); }, [initialJobId, selectSong]);
  const inputDb = 20 * Math.log10(Math.max(.00001, p.meter?.rms ?? 0));
  const level = Math.max(0, Math.min(100, (inputDb + 70) / 70 * 100));
  const note = p.meter?.midi != null ? midiToName(p.meter.midi) : "—";
  const signal = !p.micOn ? "Enable your mic to see your voice" : p.meter?.midi != null ? "Voice detected" : inputDb < p.settings.gateDb ? "Input is quiet · raise gain or lower the noise gate" : "Sound detected · try a steady vowel or lower confidence";

  if (!p.song && !p.loading && !initialJobId) return <Link className="practice-library-link" href="/songs">Choose a song from your library →</Link>;
  return <div className="practice-workspace">
    <section className="practice-stage" aria-label="Song practice">
      <header className="practice-stage__header">
        <div><p className="practice-kicker">Pitch workspace</p><h2>Follow the singer. Find your voice.</h2></div>
        <div className="practice-legend"><span><i className="reference-dot" />Singer · raw pitch</span><span><i className="mic-dot" />Your microphone</span></div>
      </header>
      <div className="practice-toolbar">
        <label>Timeline <select aria-label="Timeline zoom" value={seconds} onChange={e => setSeconds(Number(e.target.value))}><option value={6}>6 seconds</option><option value={10}>10 seconds</option><option value={20}>20 seconds</option></select></label>
        <label>Labels <select aria-label="Pitch notation" value={notation} onChange={e => setNotation(e.target.value as "notes" | "swaras")}><option value="notes">Notes</option><option value="swaras">Swaras (C = Sa)</option></select></label>
        <span>{p.playing ? "Playing" : "Paused"} · click the graph or drag the player to seek</span>
      </div>
      <div className="practice-chart">
        {p.reference && !p.loading ? <PracticeGraph reference={p.reference.contour} notes={p.reference.notes} samplesRef={p.samples} liveRef={p.live} getTime={p.getTime} playing={p.playing} seconds={seconds} notation={notation} minMidi={Math.min(33, Math.floor(hzToMidi(p.settings.minHz)) - 2)} maxMidi={Math.max(84, Math.ceil(hzToMidi(p.settings.maxHz)) + 2)} onSeek={p.seek} /> : <div className="practice-loading" role="status">{p.loading ? "Preparing the singer’s pitch…" : "Choose a song to begin."}</div>}
      </div>
      <div className="practice-input-strip">
        <div className="practice-live-note"><strong>{note}</strong><span>{p.meter?.hz ? `${Math.round(p.meter.hz)} Hz` : "Live note"}</span></div>
        <div className="practice-level"><div className="practice-meter" role="meter" aria-label="Microphone input level" aria-valuemin={-70} aria-valuemax={0} aria-valuenow={Math.round(Math.max(-70, inputDb))}><i style={{ width: `${level}%` }} /></div><span role="status">{signal}</span></div>
        <button className="practice-mic-button" aria-pressed={p.micOn} disabled={p.micStarting} onClick={() => p.micOn ? void p.stopMic() : void p.startMic()}>{p.micStarting ? "Connecting…" : p.micOn ? "Turn mic off" : "Enable microphone"}</button>
      </div>
    </section>

    <div className="practice-settings">
      <section aria-labelledby="playback-settings"><h3 id="playback-settings">Playback</h3><p>Every adjustment keeps your place.</p>
        <label>Speed <output>{p.speed.toFixed(2)}×</output><input type="range" aria-label="Playback speed" min={.5} max={1.25} step={.05} value={p.speed} onChange={e => p.setSpeed(Number(e.target.value))} /></label>
        <label>Guide vocal <output>{Math.round(p.vocalLevel * 100)}%</output><input type="range" aria-label="Guide vocal volume" min={0} max={1} step={.01} value={p.vocalLevel} onChange={e => p.setVocalLevel(Number(e.target.value))} /></label>
        <label>Backing track <output>{Math.round(p.backingLevel * 100)}%</output><input type="range" aria-label="Backing track volume" min={0} max={1} step={.01} value={p.backingLevel} onChange={e => p.setBackingLevel(Number(e.target.value))} /></label>
        <div className="practice-loop"><button onClick={() => { p.setLoopA(p.getTime()); p.setLoopOn(false); }} >Set A {p.loopA !== null && formatTime(p.loopA)}</button><button onClick={() => { p.setLoopB(p.getTime()); p.setLoopOn(false); }}>Set B {p.loopB !== null && formatTime(p.loopB)}</button><button aria-pressed={p.loopOn} disabled={p.loopA === null || p.loopB === null || p.loopB - p.loopA < .5} onClick={() => { if (!p.loopOn && p.loopA !== null) p.seek(p.loopA); p.setLoopOn(!p.loopOn); }}>{p.loopOn ? "Loop on" : "Loop A–B"}</button></div>
      </section>
      <section aria-labelledby="microphone-settings"><h3 id="microphone-settings">Microphone</h3><p>Use headphones. Keep the input above the gate.</p>
        <label>Input device<select aria-label="Microphone device" value={p.deviceId} disabled={p.micStarting} onChange={e => void p.changeDevice(e.target.value)}><option value="">System default</option>{p.devices.filter(d => d.deviceId && d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>
        <label>Input gain <output>{p.settings.gain.toFixed(1)}×</output><input type="range" aria-label="Microphone gain" min={.5} max={8} step={.1} value={p.settings.gain} onChange={e => p.updateSettings({ gain: Number(e.target.value) })} /></label>
        <label>Noise gate <output>{p.settings.gateDb} dB</output><input type="range" aria-label="Microphone noise gate" min={-70} max={-25} step={1} value={p.settings.gateDb} onChange={e => p.updateSettings({ gateDb: Number(e.target.value) })} /></label>
      </section>
      <section aria-labelledby="pitch-settings"><h3 id="pitch-settings">Microphone pitch tracking</h3><p>These controls adjust your mic trace. The singer’s pitch stays raw.</p>
        <label>Vocal range<select aria-label="Vocal range" value={`${p.settings.minHz}-${p.settings.maxHz}`} onChange={e => { const [minHz, maxHz] = e.target.value.split("-").map(Number); p.updateSettings({ minHz, maxHz }); }}><option value="55-1100">Wide · A1–C6</option><option value="55-440">Low voice · A1–A4</option><option value="110-880">Mid voice · A2–A5</option><option value="220-1500">High voice · A3–F♯6</option></select></label>
        <label>Confidence threshold <output>{Math.round(p.settings.clarity * 100)}%</output><input type="range" aria-label="Pitch confidence" min={.65} max={.95} step={.01} value={p.settings.clarity} onChange={e => p.updateSettings({ clarity: Number(e.target.value) })} /></label>
        <label>Smoothing <output>{p.settings.smoothing === 1 ? "Raw" : `${p.settings.smoothing} frames`}</output><input type="range" aria-label="Pitch smoothing" min={1} max={7} step={2} value={p.settings.smoothing} onChange={e => p.updateSettings({ smoothing: Number(e.target.value) })} /></label>
        <label>Mic timing offset <output>{p.settings.latencyMs} ms</output><input type="range" aria-label="Microphone timing offset" min={0} max={300} step={10} value={p.settings.latencyMs} onChange={e => p.updateSettings({ latencyMs: Number(e.target.value) })} /></label>
      </section>
    </div>
    <div className="practice-take"><button disabled={!p.micOn || !p.scoreReady || p.scoring} onClick={() => void p.finishAndScore()}>{p.scoring ? "Scoring…" : "Finish mic take & score"}</button><span>{p.scoring ? "You can keep listening and adjusting playback." : !p.scoreReady ? "Seeking or changing speed starts a new pass. Toggle the mic off/on at 1× for scoring." : "Optional scoring for an uninterrupted pass at 1×. Playback stays where you left it."}</span></div>
    {p.score && <section className="practice-result" aria-label="Take score"><h3>Your take</h3><span>Pitch <strong>{Math.round(p.score.intonation)}</strong></span><span>Timing <strong>{Math.round(p.score.timing)}</strong></span><span>Overall <strong>{Math.round(p.score.overall)}</strong></span></section>}
    {p.error && <p className="practice-error" role="alert">{p.error}</p>}
  </div>;
}
