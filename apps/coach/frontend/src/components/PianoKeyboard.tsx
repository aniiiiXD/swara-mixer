"use client";

import { useEffect, useRef } from "react";

const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const pc = (m: number) => ((m % 12) + 12) % 12;
const isWhite = (m: number) => WHITE_PC.includes(pc(m));

interface Props {
  lowMidi: number;
  highMidi: number;
  /** Currently sounding MIDI note (or null). Read every frame — no re-render. */
  activeRef: React.MutableRefObject<number | null>;
  height?: number;
}

/**
 * A canvas piano that highlights the note currently sounding. Reads `activeRef`
 * on its own rAF loop so the parent never has to re-render at 60fps.
 */
export default function PianoKeyboard({ lowMidi, highMidi, activeRef, height = 88 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // extend the range to whole octaves (start on C, end on B)
    let lo = Math.round(lowMidi);
    let hi = Math.round(highMidi);
    while (pc(lo) !== 0) lo--;
    while (pc(hi) !== 11) hi++;

    const whites: number[] = [];
    for (let m = lo; m <= hi; m++) if (isWhite(m)) whites.push(m);

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const active = activeRef.current === null ? null : Math.round(activeRef.current);
      const ww = w / Math.max(1, whites.length);

      // white keys
      whites.forEach((m, i) => {
        const x = i * ww;
        const on = active === m;
        ctx.fillStyle = on ? "rgba(244,183,64,0.92)" : "rgba(243,233,214,0.92)";
        ctx.fillRect(x + 0.5, 0, ww - 1, h);
        ctx.strokeStyle = "rgba(0,0,0,0.30)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, 0, ww - 1, h);
        if (pc(m) === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.font = "9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(`C${Math.floor(m / 12) - 1}`, x + ww / 2, h - 6);
        }
      });

      // black keys, overlaid at the boundary above their lower white neighbour
      const bw = ww * 0.62;
      const bh = h * 0.62;
      for (let m = lo; m <= hi; m++) {
        if (isWhite(m)) continue;
        const belowIdx = whites.indexOf(m - 1);
        if (belowIdx < 0) continue;
        const x = (belowIdx + 1) * ww - bw / 2;
        const on = active === m;
        ctx.fillStyle = on ? "rgba(244,183,64,0.95)" : "rgba(22,19,16,0.96)";
        ctx.fillRect(x, 0, bw, bh);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, 0, bw, bh);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lowMidi, highMidi, activeRef]);

  return <canvas ref={canvasRef} style={{ height }} className="w-full rounded-xl" />;
}
