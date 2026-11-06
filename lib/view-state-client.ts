"use client";

import { useEffect, useRef } from "react";

/**
 * Persist a view's filter/sort/group state per user and project.
 * The server component seeds the initial state from the same store, so
 * switching views or reloading restores each view independently.
 */
export function usePersistedViewState(
  projectId: number,
  view: "list" | "board" | "timeline" | "calendar",
  state: Record<string, string | number | boolean | null>,
) {
  const serialized = JSON.stringify(state);
  const lastSent = useRef(serialized);

  useEffect(() => {
    if (lastSent.current === serialized) return;
    lastSent.current = serialized;
    const controller = new AbortController();
    fetch("/api/view-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, view, state }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [projectId, view, serialized, state]);
}
