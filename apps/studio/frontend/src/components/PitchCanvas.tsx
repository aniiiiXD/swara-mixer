"use client";
import { useEffect, useMemo, useRef } from "react";
import type { Point, Settings } from "@/lib/types";
import { at, connects, label, pitchWindowStart } from "@/lib/pitch";
interface Props {
  reference: Point[];
  rawReference: Point[];
  take: Point[];
  rawTake: Point[];
  offset: number;
  live: React.RefObject<Point[]>;
  latest: React.RefObject<Point | null>;
  getTime: () => number;
  settings: Settings;
  onSeek: (t: number) => void;
  recording: boolean;
}
const black = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export default function PitchCanvas({
  reference,
  rawReference,
  take,
  rawTake,
  offset,
  live,
  latest,
  getTime,
  settings,
  onSeek,
  recording,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const range = useMemo(() => {
    if (!settings.focusPitch) return [33, 90];
    const pitches = rawReference
      .filter(
        (p) =>
          p.midi !== null &&
          p.conf >= 0.3 &&
          (p.rms === undefined || p.rms > 0.002),
      )
      .map((p) => p.midi!)
      .sort((a, b) => a - b);
    if (!pitches.length) return [45, 81];
    const lower = pitches[Math.floor(pitches.length * 0.02)],
      upper = pitches[Math.floor(pitches.length * 0.98)];
    const center = (lower + upper) / 2;
    return [
      Math.floor(Math.min(lower - 9, center - 12)),
      Math.ceil(Math.max(upper + 9, center + 12)),
    ];
  }, [rawReference, settings.focusPitch]);

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
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    resize();
    const draw = () => {
      const w = c.clientWidth,
        h = c.clientHeight,
        t = getTime(),
        pad = 63,
        bottom = 23,
        top = 12,
        lo = range[0],
        hi = range[1],
        span = settings.zoom,
        left = pitchWindowStart(t, span),
        step = (h - bottom - top) / (hi - lo);
      const x = (time: number) => pad + ((time - left) / span) * (w - pad);
      const y = (m: number) => h - bottom - (m - lo) * step;
      ctx.clearRect(0, 0, w, h);
      ctx.font = "9px ui-monospace,monospace";
      ctx.textBaseline = "middle";
      for (let m = lo; m <= hi; m++) {
        ctx.fillStyle = black(m) ? "#171e27" : "#202832";
        ctx.fillRect(pad, y(m) - step / 2, w - pad, step);
        ctx.strokeStyle = m % 12 === 0 ? "#536173" : "#303b49";
        ctx.lineWidth = m % 12 === 0 ? 0.8 : 0.35;
        ctx.beginPath();
        ctx.moveTo(pad, y(m));
        ctx.lineTo(w, y(m));
        ctx.stroke();
      }
      const current = latest.current;
      const active = current?.midi == null ? null : Math.round(current.midi);
      const singer = at(reference, t)?.midi;
      const singerKey = singer == null ? null : Math.round(singer);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top - step / 2, pad - 4, h - bottom - top + step);
      ctx.clip();
      const key = (m: number, b: boolean) => {
        const upper = b ? m + 0.39 : m + (black(m + 1) ? 1 : 0.5),
          lower = b ? m - 0.39 : m - (black(m - 1) ? 1 : 0.5);
        const kx = b ? 25 : 0,
          kw = pad - 4 - kx;
        ctx.fillStyle = m === active ? "#efba91" : b ? "#242d39" : "#d5dce3";
        ctx.fillRect(kx, y(upper), kw, y(lower) - y(upper));
        ctx.strokeStyle = b ? "#101720" : "#939fab";
        ctx.lineWidth = 0.7;
        ctx.strokeRect(
          kx + 0.35,
          y(upper) + 0.35,
          kw - 0.7,
          y(lower) - y(upper) - 0.7,
        );
        if (m === singerKey) {
          ctx.fillStyle = "#71bce9";
          ctx.fillRect(pad - 8, y(m) - step * 0.3, 4, step * 0.6);
        }
        if (!b && m % 12 === 0) {
          ctx.fillStyle = "#354354";
          ctx.fillText(label(m, settings), 3, y(m));
        }
      };
      for (let m = lo - 2; m <= hi + 2; m++) if (!black(m)) key(m, false);
      for (let m = lo; m <= hi; m++) if (black(m)) key(m, true);
      ctx.restore();
      const gridStep = span <= 8 ? 1 : span <= 20 ? 2 : 5;
      ctx.fillStyle = "#aab5c3";
      for (
        let time = Math.ceil(left / gridStep) * gridStep;
        time <= left + span;
        time += gridStep
      ) {
        ctx.fillText(`${time.toFixed(0)}s`, x(time) + 3, h - 8);
        ctx.strokeStyle = "#91a4b217";
        ctx.beginPath();
        ctx.moveTo(x(time), 0);
        ctx.lineTo(x(time), h - bottom);
        ctx.stroke();
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, 0, w - pad, h - bottom);
      ctx.clip();
      const line = (
        points: Point[],
        shift: number,
        color: string,
        width: number,
        raw = false,
      ) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        let previous: Point | null = null;
        for (const p of points) {
          if (p.t + shift < left - 0.1) continue;
          if (p.t + shift > left + span) break;
          if (p.midi === null) {
            previous = null;
            continue;
          }
          if (!connects(previous, p)) ctx.moveTo(x(p.t + shift), y(p.midi));
          else ctx.lineTo(x(p.t + shift), y(p.midi));
          previous = p;
        }
        ctx.setLineDash(raw ? [2, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (settings.showRaw) {
        line(rawReference, 0, "#91c6e852", 1, true);
        line(rawTake, offset, "#efba9166", 1, true);
      }
      line(reference, 0, "#91c6e8", 2);
      line(take, offset, "#efba91", 2.2);
      if (recording) line(live.current, 0, "#ffd6b5", 2.6);
      if (current?.midi != null) {
        ctx.fillStyle = "#efba91";
        ctx.beginPath();
        ctx.arc(x(t), y(current.midi), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#e2e8ef99";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(t), 0);
      ctx.lineTo(x(t), h - bottom);
      ctx.stroke();
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    range,
    reference,
    rawReference,
    take,
    rawTake,
    offset,
    live,
    latest,
    getTime,
    settings,
    recording,
  ]);
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Piano pitch comparison: singer in blue, your voice in apricot"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect(),
          dx = e.clientX - r.left - 63;
        if (dx < 0) return;
        onSeek(
          pitchWindowStart(getTime(), settings.zoom) +
            (dx / (r.width - 63)) * settings.zoom,
        );
      }}
    />
  );
}
