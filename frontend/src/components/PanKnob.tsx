"use client";

import { useRef, useCallback } from "react";

export function PanKnob({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startY.current = e.clientY;
      startValue.current = value;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = (startY.current - e.clientY) / 100;
        const newValue = Math.max(-1, Math.min(1, startValue.current + delta));
        onChange(Math.round(newValue * 100) / 100);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [value, onChange]
  );

  const rotation = value * 135;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* L/R labels */}
      <div
        className="flex justify-between w-full text-[8px] text-warm-700 px-1"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span>L</span>
        <span>R</span>
      </div>

      {/* Knob body */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onChange(0)}
        className="w-9 h-9 rounded-full bg-console-surface border border-console-border cursor-grab active:cursor-grabbing relative select-none console-groove"
      >
        {/* Outer ring marks */}
        {[-135, -90, -45, 0, 45, 90, 135].map((deg) => (
          <div
            key={deg}
            className="absolute w-0.5 h-0.5 rounded-full bg-warm-800"
            style={{
              top: "50%",
              left: "50%",
              transform: `rotate(${deg}deg) translateY(-16px) translate(-50%, -50%)`,
            }}
          />
        ))}

        {/* Indicator line */}
        <div
          className="absolute w-0.5 h-3 rounded-full"
          style={{
            backgroundColor: color,
            left: "calc(50% - 1px)",
            top: "5px",
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center 13px",
            opacity: 0.9,
          }}
        />
      </div>

      {/* Label */}
      <span
        className="text-[8px] text-warm-700 tracking-[0.15em]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        PAN
      </span>
    </div>
  );
}
