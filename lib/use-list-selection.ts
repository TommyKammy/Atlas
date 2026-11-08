"use client";

import { useRef, useState } from "react";

/** Selection state for list rows (single toggle, shift range, select-all). */
export function useListSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchorRef = useRef<number | null>(null);

  const toggleSelect = (id: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchorRef.current = id;
      return next;
    });

  const selectRange = (ids: number[], id: number) => {
    const anchor = anchorRef.current;
    if (anchor !== null) {
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(lo, hi + 1)));
        anchorRef.current = id;
        return true;
      }
    }
    // First Shift-click starts a selection at the clicked row.
    setSelected(new Set([id]));
    anchorRef.current = id;
    return true;
  };

  const toggleAll = (ids: number[]) => {
    if (ids.length > 0 && ids.every((id) => selected.has(id))) setSelected(new Set());
    else setSelected(new Set(ids));
  };

  const clear = () => setSelected(new Set());

  return { selected, setSelected, toggleSelect, selectRange, toggleAll, clear };
}
