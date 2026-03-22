"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import { StemName, StemState, STEM_COLORS, STEM_LABELS } from "@/types";
import { VolumeSlider } from "./VolumeSlider";
import { PanKnob } from "./PanKnob";

export function StemTrack({
  name,
  state,
  currentTime,
  duration,
  audioBuffer,
  onStateChange,
}: {
  name: StemName;
  state: StemState;
  currentTime: number;
  duration: number;
  audioBuffer: AudioBuffer | null;
  onStateChange: (update: Partial<StemState>) => void;
}) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const color = STEM_COLORS[name];
  const label = STEM_LABELS[name];

  useEffect(() => {
    if (!waveformRef.current || !audioBuffer) return;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: `${color}30`,
      progressColor: `${color}90`,
      cursorColor: "rgba(200, 149, 108, 0.3)",
      cursorWidth: 1,
      height: 80,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      interact: false,
      normalize: true,
    });

    const wavData = audioBufferToWav(audioBuffer);
    const blob = new Blob([wavData], { type: "audio/wav" });
    ws.loadBlob(blob);
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioBuffer, color]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !duration) return;
    ws.seekTo(Math.min(currentTime / duration, 1));
  }, [currentTime, duration]);

  const isMuted = state.mute;

  return (
    <div
      className={`flex items-stretch gap-4 px-4 py-3 rounded-lg border transition-all ${
        isMuted
          ? "bg-console/50 border-console-border/50 opacity-40"
          : "bg-console border-console-border hover:border-console-highlight"
      }`}
      style={{ borderLeftWidth: "3px", borderLeftColor: isMuted ? undefined : color }}
    >
      {/* Label + Solo/Mute */}
      <div className="flex flex-col items-center justify-center gap-2.5 w-16 shrink-0">
        <span
          className="text-[10px] font-medium tracking-[0.2em]"
          style={{ color, fontFamily: "var(--font-mono)" }}
        >
          {label}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => onStateChange({ solo: !state.solo })}
            className={`w-6 h-6 rounded text-[9px] font-medium transition-all btn-press ${
              state.solo
                ? "text-warm-950"
                : "bg-console-surface border border-console-border text-warm-600 hover:text-warm-400"
            }`}
            style={
              state.solo
                ? { backgroundColor: "var(--color-amber-accent)" }
                : {}
            }
          >
            S
          </button>
          <button
            onClick={() => onStateChange({ mute: !state.mute })}
            className={`w-6 h-6 rounded text-[9px] font-medium transition-all btn-press ${
              state.mute
                ? "bg-[#6b3a3a] text-[#d4867a]"
                : "bg-console-surface border border-console-border text-warm-600 hover:text-warm-400"
            }`}
          >
            M
          </button>
        </div>
      </div>

      {/* Waveform */}
      <div className="flex-1 min-w-0 flex items-center">
        <div
          ref={waveformRef}
          className="w-full rounded overflow-hidden waveform-container"
          style={{ background: "rgba(0,0,0,0.2)" }}
        />
      </div>

      {/* Pan */}
      <div className="flex items-center shrink-0">
        <PanKnob
          value={state.pan}
          onChange={(pan) => onStateChange({ pan })}
          color={color}
        />
      </div>

      {/* Volume */}
      <div className="flex items-center shrink-0">
        <VolumeSlider
          value={state.gain}
          onChange={(gain) => onStateChange({ gain })}
          color={color}
        />
      </div>
    </div>
  );
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
