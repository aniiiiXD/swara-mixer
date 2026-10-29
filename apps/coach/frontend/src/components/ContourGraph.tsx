"use client";

import { useEffect, useRef } from "react";
import { centsColor, midiToSwara } from "@/lib/pitch";

export interface ContourPoint {
  t: number; // seconds
  midi: number | null; // null = gap / unvoiced
}

export interface NoteSeg {
  midi: number;
  name: string;
  start: number;
  end: number;
  cents_offset: number;
}

interface Props {
  points: ContourPoint[];
  notes?: NoteSeg[];
  height?: number;
}

function drawSwara(
  ctx: CanvasRenderingContext2D,
  midi: number,
  x: number,
  y: number,
  devaFamily: string,
) {
  const s = midiToSwara(midi);
  ctx.fillStyle = s.pc === 0 ? "rgba(244,183,64,0.7)" : "rgba(243,233,214,0.5)";
  ctx.font = `${s.komal ? "italic " : ""}14px ${devaFamily}`;
  ctx.fillText(s.dev, x, y);
  const w = ctx.measureText(s.dev).width;
  ctx.fillStyle = "rgba(244,183,64,0.7)";
  for (let i = 0; i < Math.abs(s.octave); i++) {
    const dy = s.octave > 0 ? y - 10 : y + 10;
    ctx.beginPath();
    ctx.arc(x + w / 2 + (i - (Math.abs(s.octave) - 1) / 2) * 5, dy, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Static, fit-to-width pitch contour for a finished take. Swara-lane gridlines,
 * the continuous pitch line (gold→vermillion by intonation), and the segmented
 * notes as bars at their target swara across their time span.
 */
export default function ContourGraph({ points, notes = [], height = 240 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const devaFamily =
      getComputedStyle(document.documentElement).getPropertyValue("--font-deva").trim() ||
      "serif";

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const voiced = points.filter((p) => p.midi !== null) as { t: number; midi: number }[];
      if (!voiced.length && !notes.length) {
        ctx.fillStyle = "rgba(243,233,214,0.4)";
        ctx.font = `13px ${devaFamily}`;
        ctx.fillText("कोई स्वर नहीं — no pitch detected", 14, h / 2);
        return;
      }

      const allMidi = [...voiced.map((p) => p.midi), ...notes.map((n) => n.midi)];
      const midiMin = Math.floor(Math.min(...allMidi)) - 1;
      let midiMax = Math.ceil(Math.max(...allMidi)) + 1;
      if (midiMax - midiMin < 4) midiMax = midiMin + 4;
      const duration = Math.max(
        points.length ? points[points.length - 1].t : 0,
        notes.length ? notes[notes.length - 1].end : 0,
        0.001,
      );

      const padL = 44;
      const midiToY = (m: number) => h - ((m - midiMin) / (midiMax - midiMin)) * (h - 10) - 5;
      const tToX = (t: number) => padL + (t / duration) * (w - padL - 8);

      ctx.textBaseline = "middle";
      for (let m = midiMin; m <= midiMax; m++) {
        const s = midiToSwara(m);
        if (s.komal || s.tivra) {
          ctx.fillStyle = "rgba(244,183,64,0.025)";
          ctx.fillRect(padL, midiToY(m + 0.5), w - padL, midiToY(m - 0.5) - midiToY(m + 0.5));
        }
        const y = midiToY(m);
        ctx.strokeStyle = s.pc === 0 ? "rgba(244,183,64,0.2)" : "rgba(243,233,214,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        drawSwara(ctx, m, 8, y, devaFamily);
      }

      // note segment bars
      for (const n of notes) {
        const x0 = tToX(n.start);
        const x1 = tToX(n.end);
        const y = midiToY(n.midi);
        ctx.fillStyle = "rgba(244,183,64,0.1)";
        ctx.fillRect(x0, y - 5, Math.max(x1 - x0, 2), 10);
        ctx.strokeStyle = centsColor(n.cents_offset);
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y - 5, Math.max(x1 - x0, 2), 10);
      }

      // continuous contour with a soft glow
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(244,183,64,0.3)";
      ctx.shadowBlur = 5;
      let started = false;
      let px = 0;
      let py = 0;
      for (const p of points) {
        if (p.midi === null) {
          started = false;
          continue;
        }
        const x = tToX(p.t);
        const y = midiToY(p.midi);
        if (started) {
          ctx.strokeStyle = centsColor((p.midi - Math.round(p.midi)) * 100);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        px = x;
        py = y;
        started = true;
      }
      ctx.shadowBlur = 0;
    };

    render();
    // Devanagari font may load after first paint — redraw once it's ready.
    document.fonts?.ready.then(render).catch(() => {});
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [points, notes, height]);

  return <canvas ref={canvasRef} style={{ height }} className="w-full rounded-2xl" />;
}
