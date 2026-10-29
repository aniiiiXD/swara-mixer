"use client";

import { useEffect, useRef } from "react";
import { midiToName, midiToSwara, type PitchSample } from "@/lib/pitch";
import type { ContourPoint, NoteSeg } from "@/components/ContourGraph";

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

interface Props {
  reference: ContourPoint[];
  notes: NoteSeg[];
  samplesRef: React.MutableRefObject<PitchSample[]>;
  liveRef?: React.MutableRefObject<PitchSample | null>;
  getTime: () => number;
  playing: boolean;
  seconds?: number;
  minMidi?: number;
  maxMidi?: number;
  notation?: "notes" | "swaras";
  onSeek?: (time: number) => void;
}

/** A fixed pitch axis: changing mic input never moves the reference under it. */
export default function PracticeGraph({ reference, samplesRef, liveRef, getTime, playing, seconds = 10, minMidi = 33, maxMidi = 84, notation = "notes", onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const pad = 66;
  const past = seconds * .6;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, now = getTime();
      const left = now - past;
      const x = (t: number) => pad + (t - left) / seconds * (w - pad);
      const y = (m: number) => h - 24 - (m - minMidi) / (maxMidi - minMidi) * (h - 44);
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "middle";
      ctx.font = "11px ui-monospace, monospace";
      const keyHeight = (h - 44) / (maxMidi - minMidi);
      for (let m = Math.ceil(minMidi); m <= maxMidi; m++) {
        ctx.fillStyle = isBlackKey(m) ? "rgba(0,0,0,.13)" : "rgba(235,214,182,.015)";
        ctx.fillRect(pad, y(m) - keyHeight / 2, w - pad, keyHeight);
        ctx.strokeStyle = m % 12 === 0 ? "rgba(235,214,182,.23)" : "rgba(235,214,182,.07)";
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, y(m)); ctx.lineTo(w, y(m)); ctx.stroke();
      }
      // The same y() positions the keys and contour: each key's pitch center
      // meets its semitone line, including the black keys between white keys.
      ctx.save(); ctx.beginPath(); ctx.rect(0, y(maxMidi) - keyHeight / 2, pad - 5, (maxMidi - minMidi + 1) * keyHeight); ctx.clip();
      const micMidi = liveRef?.current?.midi;
      const active = micMidi == null ? null : Math.round(micMidi);
      const drawKey = (m: number, black: boolean) => {
        const upper = black ? m + .39 : m + (isBlackKey(m + 1) ? 1 : .5);
        const lower = black ? m - .39 : m - (isBlackKey(m - 1) ? 1 : .5);
        const keyX = black ? 24 : 0;
        const keyWidth = pad - 5 - keyX;
        const top = y(upper), height = y(lower) - top;
        ctx.fillStyle = active === m ? "#f7c967" : black ? "#24221f" : "#e8e1d5";
        ctx.fillRect(keyX, top, keyWidth, height);
        ctx.strokeStyle = black ? "#0f0e0c" : "#9c9589"; ctx.lineWidth = .7;
        ctx.strokeRect(keyX + .35, top + .35, keyWidth - .7, height - .7);
        if (!black && (m % 12 === 0 || keyHeight >= 12)) {
          ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = "#51483c";
          ctx.fillText(notation === "notes" ? midiToName(m) : `${midiToSwara(m).lat}${Math.floor(m / 12) - 1}`, 4, y(m));
        }
      };
      for (let m = Math.floor(minMidi) - 2; m <= Math.ceil(maxMidi) + 2; m++) if (!isBlackKey(m)) drawKey(m, false);
      for (let m = Math.floor(minMidi); m <= Math.ceil(maxMidi); m++) if (isBlackKey(m)) drawKey(m, true);
      ctx.restore(); ctx.font = "11px ui-monospace, monospace";
      for (let t = Math.max(0, Math.ceil(left)); t < left + seconds; t++) {
        ctx.fillStyle = "#8e867c"; ctx.fillText(`${t}s`, x(t) + 3, h - 9);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(pad, 0, w - pad, h - 20); ctx.clip();
      ctx.lineWidth = 1.75; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "#69bbb4";
      ctx.beginPath();
      let previous: ContourPoint | null = null;
      for (const point of reference) {
        if (point.t < left) continue;
        if (point.t > left + seconds) break;
        if (point.midi === null) { previous = null; continue; }
        // Preserve every raw pitch estimate, including fast jumps and single
        // frames. Break only where the source actually has missing data.
        if (!previous || previous.midi === null || point.t - previous.t > .15) ctx.moveTo(x(point.t), y(point.midi));
        else ctx.lineTo(x(point.t), y(point.midi));
        ctx.fillStyle = "#69bbb4"; ctx.fillRect(x(point.t) - .75, y(point.midi) - .75, 1.5, 1.5);
        previous = point;
      }
      ctx.stroke();
      ctx.lineWidth = 3.5; ctx.strokeStyle = "#f7c967";
      ctx.beginPath();
      let last: PitchSample | null = null;
      let visible: PitchSample | null = null;
      for (const sample of samplesRef.current) {
        if (sample.time < left || sample.time > now + .03) continue;
        if (sample.midi === null) { last = null; continue; }
        if (!last || last.midi === null || sample.time - last.time > .2 || sample.time <= last.time || Math.abs(sample.midi - last.midi) > 7) ctx.moveTo(x(sample.time), y(sample.midi));
        else ctx.lineTo(x(sample.time), y(sample.midi));
        last = sample; visible = sample;
      }
      ctx.stroke();
      // While paused show a mic preview, without stacking samples at one time.
      const current = !playing ? liveRef?.current : visible;
      const latest = liveRef?.current;
      if (current?.midi != null && (!playing || (latest?.midi != null && now - current.time < .3))) {
        ctx.fillStyle = "#f7c967"; ctx.beginPath(); ctx.arc(playing ? x(current.time) : x(now), y(current.midi), 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(244,225,194,.65)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(now), 0); ctx.lineTo(x(now), h - 20); ctx.stroke();
      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); observer.disconnect(); };
  }, [reference, samplesRef, liveRef, getTime, playing, seconds, past, minMidi, maxMidi, notation]);

  return <canvas ref={canvasRef} className="h-full w-full rounded-xl" role="img" aria-label="Vertical piano keyboard aligned with every semitone; raw singer pitch in teal and your microphone pitch in gold"
    onPointerDown={onSeek ? e => { const rect = e.currentTarget.getBoundingClientRect(); const offset = e.clientX - rect.left - pad; if (offset < 0) return; const fraction = Math.max(0, Math.min(1, offset / (rect.width - pad))); onSeek(Math.max(0, getTime() - past + fraction * seconds)); } : undefined} />;
}
