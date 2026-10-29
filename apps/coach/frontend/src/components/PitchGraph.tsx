"use client";

import { useEffect, useRef } from "react";
import { centsColor, midiToName, midiToSwara, type PitchSample } from "@/lib/pitch";

interface Props {
  /** Rolling buffer of samples, mutated outside React for performance. */
  samplesRef: React.MutableRefObject<PitchSample[]>;
  running: boolean;
  windowSeconds?: number;
  midiMin?: number; // C3 = 48
  midiMax?: number; // C5 = 72
  notation?: "indian" | "english";
  followPitch?: boolean;
}

/** Draw a swara label with mandra/taar octave dots at (x, y) in the canvas. */
function drawPitchLabel(
  ctx: CanvasRenderingContext2D,
  midi: number,
  x: number,
  y: number,
  devaFamily: string,
  notation: "indian" | "english",
) {
  const s = midiToSwara(midi);
  ctx.fillStyle = "rgba(243,233,214,0.5)";
  const label = notation === "indian" ? s.dev : midiToName(midi);
  ctx.font = notation === "indian" ? `${s.komal ? "italic " : ""}15px ${devaFamily}` : "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(label, x, y);
  const w = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(244,183,64,0.7)";
  for (let i = 0; i < Math.abs(s.octave); i++) {
    const dy = s.octave > 0 ? y - 11 : y + 11;
    ctx.beginPath();
    ctx.arc(x + w / 2 + (i - (Math.abs(s.octave) - 1) / 2) * 5, dy, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function PitchGraph({
  samplesRef,
  running,
  windowSeconds = 6,
  midiMin = 48,
  midiMax = 72,
  notation = "indian",
  followPitch = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const devaFamily =
      getComputedStyle(document.documentElement).getPropertyValue("--font-deva").trim() ||
      "serif";

    const PAD = 46;
    const span = midiMax - midiMin;
    let center = (midiMin + midiMax) / 2;
    const midiToY = (midi: number, h: number, lo: number, hi: number) =>
      h - ((midi - lo) / (hi - lo)) * h;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const samples = samplesRef.current;
      const now = samples.length ? samples[samples.length - 1].time : 0;
      const t0 = now - windowSeconds;
      const timeToX = (t: number) => PAD + ((t - t0) / windowSeconds) * (w - PAD);
      const lastVoiced = [...samples].reverse().find((sample) => sample.midi !== null)?.midi;
      if (followPitch && lastVoiced !== null && lastVoiced !== undefined) center += (lastVoiced - center) * 0.08;
      const lo = followPitch ? center - span / 2 : midiMin;
      const hi = followPitch ? center + span / 2 : midiMax;

      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "middle";

      // --- swara lanes + gridlines (komal lanes faintly shaded) ---
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        const s = midiToSwara(m);
        const yTop = midiToY(m + 0.5, h, lo, hi);
        const yBot = midiToY(m - 0.5, h, lo, hi);
        if (s.komal || s.tivra) {
          ctx.fillStyle = "rgba(244,183,64,0.025)";
          ctx.fillRect(PAD, yTop, w - PAD, yBot - yTop);
        }
        const y = midiToY(m, h, lo, hi);
        // Sa lanes get a slightly stronger line as tonic anchors
        ctx.strokeStyle = s.pc === 0 ? "rgba(244,183,64,0.22)" : "rgba(243,233,214,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        drawPitchLabel(ctx, m, 8, y, devaFamily, notation);
      }

      // --- "now" line ---
      ctx.strokeStyle = "rgba(243,233,214,0.22)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(w - 1, 0);
      ctx.lineTo(w - 1, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- the continuous pitch ribbon ---
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(244,183,64,0.35)";
      ctx.shadowBlur = 6;
      let started = false;
      let prevX = 0;
      let prevY = 0;
      for (const s of samples) {
        if (s.time < t0) continue;
        if (s.hz === null || s.midi === null) {
          started = false;
          continue;
        }
        const x = timeToX(s.time);
        const y = midiToY(s.midi, h, lo, hi);
        const cents = (s.midi - Math.round(s.midi)) * 100;
        if (started) {
          ctx.strokeStyle = centsColor(cents);
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        prevX = x;
        prevY = y;
        started = true;
      }
      ctx.shadowBlur = 0;

      // --- live readout dot ---
      const last = samples[samples.length - 1];
      if (last && last.hz !== null && last.midi !== null) {
        const y = midiToY(last.midi, h, lo, hi);
        const col = centsColor((last.midi - Math.round(last.midi)) * 100);
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(w - 1, y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [samplesRef, windowSeconds, midiMin, midiMax, notation, followPitch, running]);

  return <canvas ref={canvasRef} className="h-full w-full rounded-2xl" />;
}
