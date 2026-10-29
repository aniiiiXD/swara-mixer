"use client";

import { midiToSwara } from "@/lib/pitch";

interface Props {
  midi: number;
  size?: number; // glyph font-size in px
  color?: string;
  showLatin?: boolean;
}

/** Octave dots: a dot above per taar saptak, below per mandra saptak. */
function Dots({ count, above }: { count: number; above: boolean }) {
  if (count <= 0) return <span className="block" style={{ height: 6 }} />;
  return (
    <span
      className="flex justify-center gap-[3px]"
      style={{ height: 6, alignItems: above ? "flex-end" : "flex-start" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{ width: 3, height: 3, background: "currentColor", opacity: 0.85 }}
        />
      ))}
    </span>
  );
}

export default function SwaraLabel({ midi, size = 40, color, showLatin = false }: Props) {
  const s = midiToSwara(midi);
  return (
    <span className="inline-flex flex-col items-center leading-none" style={{ color }}>
      <Dots count={Math.max(s.octave, 0)} above />
      <span
        className="font-deva"
        style={{ fontSize: size, fontStyle: s.komal ? "italic" : "normal" }}
      >
        {s.dev}
      </span>
      <Dots count={Math.max(-s.octave, 0)} above={false} />
      {showLatin && (
        <span className="font-body mt-1 text-[0.62em] tracking-wide opacity-70">{s.lat}</span>
      )}
    </span>
  );
}
