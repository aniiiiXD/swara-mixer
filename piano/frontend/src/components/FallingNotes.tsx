"use client";

import { useEffect, useRef } from "react";
import type { Note } from "@/lib/api";

// Piano span: A0 (21) .. C8 (108) — 88 keys.
const FIRST = 21;
const LAST = 108;
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number) => BLACK.has(((m % 12) + 12) % 12);

const KEYBOARD_H = 88;     // px reserved for the keyboard at the bottom
const PX_PER_SEC = 150;    // fall speed

interface KeyBox {
  x: number;
  w: number;
  black: boolean;
}

function buildLayout(width: number): Record<number, KeyBox> {
  const whites: number[] = [];
  for (let m = FIRST; m <= LAST; m++) if (!isBlack(m)) whites.push(m);
  const whiteW = width / whites.length;

  const map: Record<number, KeyBox> = {};
  let wi = 0;
  for (let m = FIRST; m <= LAST; m++) {
    if (!isBlack(m)) {
      map[m] = { x: wi * whiteW, w: whiteW, black: false };
      wi++;
    }
  }
  const bw = whiteW * 0.62;
  for (let m = FIRST; m <= LAST; m++) {
    if (isBlack(m)) {
      const left = map[m - 1]; // m-1 is always a white key for a black key
      map[m] = { x: left.x + whiteW - bw / 2, black: true, w: bw };
    }
  }
  return map;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function FallingNotes({
  notes,
  audioEl,
}: {
  notes: Note[];
  audioEl: HTMLAudioElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    let layout: Record<number, KeyBox> = {};

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      cssW = parent.clientWidth;
      cssH = parent.clientHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout = buildLayout(cssW);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const draw = () => {
      const t = audioEl?.currentTime ?? 0;
      const strikeY = cssH - KEYBOARD_H;
      const all = notesRef.current;

      ctx.clearRect(0, 0, cssW, cssH);

      // active pitches (currently sounding) for key highlighting
      const active = new Set<number>();

      // ── falling notes ──────────────────────────────────────────────
      for (const n of all) {
        const box = layout[n.midi];
        if (!box) continue;
        if (n.start <= t && t <= n.end) active.add(n.midi);

        const bottomY = strikeY - (n.start - t) * PX_PER_SEC; // leading edge
        const topY = strikeY - (n.end - t) * PX_PER_SEC;      // trailing edge
        if (bottomY < 0 || topY > strikeY) continue;          // off-screen / already played

        const drawBottom = Math.min(bottomY, strikeY);        // clip into the strike line
        const h = Math.max(3, drawBottom - topY);
        const v = n.velocity / 127;                           // dynamics → brightness
        const alpha = 0.32 + 0.68 * v;
        // deep amber → bright ivory-amber as velocity rises
        const r = Math.round(200 + 55 * v);
        const g = Math.round(149 + 68 * v);
        const b = Math.round(108 + 60 * v);
        const inset = box.black ? 1.5 : 1;

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.shadowColor = "rgba(212, 165, 116, 0.5)";
        ctx.shadowBlur = 4 + 10 * v;
        roundRect(ctx, box.x + inset, topY, box.w - inset * 2, h, 3);
        ctx.fill();
        ctx.shadowBlur = 0;
        // bright leading cap
        ctx.fillStyle = `rgba(245, 232, 210, ${0.5 + 0.5 * v})`;
        roundRect(ctx, box.x + inset, drawBottom - 3, box.w - inset * 2, 3, 2);
        ctx.fill();
      }

      // ── strike line ────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(212, 165, 116, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, strikeY);
      ctx.lineTo(cssW, strikeY);
      ctx.stroke();

      // ── keyboard: white keys first, then black on top ──────────────
      const kbTop = strikeY;
      for (let m = FIRST; m <= LAST; m++) {
        const box = layout[m];
        if (!box || box.black) continue;
        const lit = active.has(m);
        ctx.fillStyle = lit ? "#e9c79a" : "#efe7d8";
        ctx.fillRect(box.x + 0.5, kbTop, box.w - 1, KEYBOARD_H);
        if (lit) {
          ctx.fillStyle = "rgba(212, 165, 116, 0.55)";
          ctx.fillRect(box.x + 0.5, kbTop, box.w - 1, KEYBOARD_H);
        }
        ctx.strokeStyle = "rgba(26, 22, 20, 0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 0.5, kbTop, box.w - 1, KEYBOARD_H);
      }
      for (let m = FIRST; m <= LAST; m++) {
        const box = layout[m];
        if (!box || !box.black) continue;
        const lit = active.has(m);
        ctx.fillStyle = lit ? "#c8956c" : "#221d1a";
        ctx.fillRect(box.x, kbTop, box.w, KEYBOARD_H * 0.62);
        if (lit) {
          ctx.shadowColor = "rgba(212, 165, 116, 0.8)";
          ctx.shadowBlur = 8;
          ctx.fillRect(box.x, kbTop, box.w, KEYBOARD_H * 0.62);
          ctx.shadowBlur = 0;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [audioEl]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}
