"use client";

import { useEffect } from "react";

// Live invalidation for one project: WebSocket first, polling fallback when
// the socket cannot connect or drops. `onEvent` must be a stable callback.
export function useLive(projectId: number, enabled: boolean, onEvent: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const fire = () => {
      if (!stopped && document.visibilityState === "visible") onEvent();
    };
    const startPoll = () => {
      stopPoll();
      poll = setInterval(fire, 20000);
    };
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    try {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?project=${projectId}`,
      );
      ws.onmessage = fire;
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        ws = null;
        if (!stopped) startPoll();
      };
    } catch {
      startPoll();
    }
    return () => {
      stopped = true;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      stopPoll();
    };
  }, [projectId, enabled, onEvent]);
}
