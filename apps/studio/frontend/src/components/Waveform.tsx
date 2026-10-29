"use client";
import { useEffect, useRef } from "react";
import type { Track } from "@/lib/types";
export default function Waveform({
  track,
  duration,
  getTime,
  onSeek,
  selected,
}: {
  track: Track;
  duration: number;
  getTime: () => number;
  onSeek: (n: number) => void;
  selected: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();
    const draw = () => {
      const w = c.clientWidth,
        h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const x = (track.start / duration) * w,
        width = (track.duration / duration) * w;
      ctx.fillStyle = track.color + (track.muted ? "09" : "18");
      ctx.fillRect(x, 5, width, h - 10);
      ctx.strokeStyle = track.color + (track.muted ? "44" : "ae");
      ctx.lineWidth = 1;
      ctx.beginPath();
      const max = Math.max(0.02, ...track.peaks);
      for (let i = 0; i < track.peaks.length; i++) {
        const px = x + (i / track.peaks.length) * width,
          v = Math.max(1, (track.peaks[i] / max) * (h * 0.35));
        ctx.moveTo(px, h / 2 - v);
        ctx.lineTo(px, h / 2 + v);
      }
      ctx.stroke();
      if (selected) {
        ctx.strokeStyle = track.color + "88";
        ctx.strokeRect(x + 0.5, 5.5, width - 1, h - 11);
      }
      ctx.strokeStyle = "#e4e9efbb";
      ctx.beginPath();
      ctx.moveTo((getTime() / duration) * w, 0);
      ctx.lineTo((getTime() / duration) * w, h);
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [track, duration, getTime, selected]);
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={`${track.name} waveform`}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
    />
  );
}
