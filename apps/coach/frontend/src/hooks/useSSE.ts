"use client";

import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "@/types";

export function useSSE(url: string | null) {
  const [event, setEvent] = useState<ProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url) return;

    // `url` is already an absolute Tonic-API URL (see getProgressUrl); the API
    // streams the engine's SSE through unbuffered.
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
    };

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.phase) {
          setEvent(data as ProgressEvent);
        }
        // Close after terminal events
        if (data.phase === "complete" || data.phase === "error") {
          source.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects, but if the stream ended normally
      // (server closed after complete/error), readyState will be CLOSED
      if (source.readyState === EventSource.CLOSED) {
        setConnected(false);
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [url]);

  return { event, connected };
}
