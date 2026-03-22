"use client";

export function VolumeSlider({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  const pct = (value / 1.5) * 100;

  return (
    <div className="flex flex-col items-center gap-1.5 h-44">
      {/* dB readout */}
      <span
        className="text-[9px] text-warm-500 w-10 text-center"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value === 0 ? "-∞" : `${((20 * Math.log10(value)) | 0)}dB`}
      </span>

      {/* Fader track */}
      <div className="relative flex-1 w-6 flex items-center justify-center">
        {/* Track groove */}
        <div className="absolute w-1 h-full bg-console rounded-full console-groove" />

        {/* Filled level */}
        <div
          className="absolute bottom-0 w-1 rounded-full transition-all duration-75"
          style={{
            height: `${pct}%`,
            backgroundColor: color,
            opacity: 0.6,
          }}
        />

        {/* Tick marks */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <div
            key={tick}
            className="absolute w-2 h-px bg-warm-800"
            style={{ bottom: `${tick}%`, left: "2px" }}
          />
        ))}

        {/* Invisible range */}
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute w-full h-full opacity-0 cursor-pointer"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
        />

        {/* Fader cap */}
        <div
          className="absolute w-5 h-3 rounded-[2px] bg-console-raised border border-console-border pointer-events-none console-raised"
          style={{ bottom: `calc(${pct}% - 6px)` }}
        >
          {/* Center line on cap */}
          <div className="absolute top-1/2 left-1 right-1 h-px bg-warm-700 -translate-y-1/2" />
        </div>
      </div>
    </div>
  );
}
