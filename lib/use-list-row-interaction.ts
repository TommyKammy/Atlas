"use client";

import { useState } from "react";
import type { TaskRow } from "./data";

/** Row click, shift-range selection and subtask expansion for the list view. */
export function useListRowInteraction({
  projectId,
  router,
  visible,
  selectRange,
  toggleSelect,
  subtasksCollapsed,
  isDragging,
}: {
  projectId: number;
  router: { push: (href: string) => void };
  visible: TaskRow[];
  selectRange: (ids: number[], id: number) => boolean;
  toggleSelect: (id: number) => void;
  subtasksCollapsed: boolean;
  isDragging: () => boolean;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };

  const rowClick = (event: React.MouseEvent, id: number) => {
    if (isDragging()) return;
    if ((event.target as HTMLElement).closest("a,button,input,select,textarea,summary,[contenteditable]")) {
      return;
    }
    if (event.shiftKey) {
      const visibleSet = new Set(visible.map((task) => task.id));
      const ids = [...document.querySelectorAll<HTMLElement>("[data-list-row]")]
        .map((element) => Number(element.getAttribute("data-list-row")))
        .filter((rowId) => visibleSet.has(rowId));
      if (selectRange(ids, id)) return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelect(id);
      return;
    }
    openTask(id);
  };

  const toggleExpand = (id: number) => {
    if (subtasksCollapsed) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearExpanded = () => setExpanded(new Set());

  return { expanded, openTask, rowClick, toggleExpand, clearExpanded };
}
