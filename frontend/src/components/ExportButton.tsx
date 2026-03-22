"use client";

import { useState } from "react";
import { exportMix } from "@/lib/api";
import type { MixState } from "@/types";

export function ExportButton({
  jobId,
  mixState,
}: {
  jobId: string;
  mixState: MixState;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const mix: Record<string, { gain: number; pan: number; mute: boolean }> = {};
      for (const [stem, state] of Object.entries(mixState)) {
        mix[stem] = { gain: state.gain, pan: state.pan, mute: state.mute };
      }

      const { downloadUrl } = await exportMix(jobId, mix);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = "stem-studio-mix.wav";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleExport}
        disabled={exporting}
        className="px-4 py-2 border border-console-border hover:border-warm-600 disabled:opacity-40 rounded-lg text-xs text-warm-400 tracking-wide transition-all btn-press flex items-center gap-2"
      >
        {exporting ? (
          <>
            <span className="w-3 h-3 border border-warm-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-warm-500">Exporting</span>
          </>
        ) : (
          <>
            <svg
              className="w-3.5 h-3.5 text-warm-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export
          </>
        )}
      </button>
      {error && <span className="text-[#a65a4e] text-xs">{error}</span>}
    </div>
  );
}
