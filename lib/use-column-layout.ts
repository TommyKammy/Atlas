"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_WIDTH: Record<string, number> = {
  assignee: 119,
  due: 119,
  progress: 119,
  status: 119,
};

/** Column width/order persistence, resize handles, drag reorder and grid template. */
export function useColumnLayout({
  projectId,
  baseKeys,
  hiddenCols,
  hiddenKeys,
  statusHidden,
  onMenuClose,
}: {
  projectId: number;
  baseKeys: string[];
  hiddenCols: Set<number>;
  hiddenKeys: Set<string>;
  statusHidden: boolean;
  onMenuClose: () => void;
}) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [colOrder, setColOrder] = useState<string[]>([]);
  const [loadedStoreKey, setLoadedStoreKey] = useState<string | null>(null);
  const [colDragging, setColDragging] = useState<string | null>(null);
  const [colDropOver, setColDropOver] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const colDragCand = useRef<{ key: string; x: number } | null>(null);

  const colW = (key: string) =>
    colWidths[key] ?? (key.startsWith("cf-") ? 130 : DEFAULT_WIDTH[key] ?? 119);

  const orderedKeys = [
    ...colOrder.filter((k) => baseKeys.includes(k)),
    ...baseKeys.filter((k) => !colOrder.includes(k)),
  ];
  const visibleCols = orderedKeys.filter((k) =>
    hiddenKeys.has(k)
      ? false
      : k === "status"
        ? !statusHidden
        : k.startsWith("cf-")
          ? !hiddenCols.has(Number(k.slice(3)))
          : true,
  );
  const nameW = colWidths["name"];
  const gridCols = isCompact
    ? "28px minmax(0,1fr)"
    : `28px ${nameW ? `${nameW}px` : "minmax(220px,640px)"}${visibleCols.map((k) => ` ${colW(k)}px`).join("")} minmax(40px,1fr)`;
  const compactCells = isCompact ? "[&>*:nth-child(n+3)]:hidden" : "";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const candidate = colDragCand.current;
      if (candidate && Math.abs(event.clientX - candidate.x) > 6) {
        setColDragging(candidate.key);
        colDragCand.current = null;
      }
    };
    const onUp = () => {
      colDragCand.current = null;
      setColDragging(null);
      setColDropOver(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const storeKey = `atlas-listcols-${projectId}`;
  const loaded = loadedStoreKey === storeKey;
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const widths = JSON.parse(localStorage.getItem(`${storeKey}:w`) ?? "{}");
        const order = JSON.parse(localStorage.getItem(`${storeKey}:o`) ?? "[]");
        if (widths && typeof widths === "object" && !Array.isArray(widths)) setColWidths(widths);
        else setColWidths({});
        if (Array.isArray(order)) setColOrder(order.filter((key) => typeof key === "string"));
        else setColOrder([]);
      } catch {
        setColWidths({});
        setColOrder([]);
      } finally {
        setLoadedStoreKey(storeKey);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storeKey]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(`${storeKey}:w`, JSON.stringify(colWidths));
    } catch {
      /* ignore */
    }
  }, [colWidths, storeKey, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(`${storeKey}:o`, JSON.stringify(colOrder));
    } catch {
      /* ignore */
    }
  }, [colOrder, storeKey, loaded]);

  const startResize = (event: React.MouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW =
      key === "name" && colWidths[key] == null
        ? ((event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().width ?? 240)
        : colW(key);

    // The name column is elastic while idle. Freeze it at its rendered width
    // before resizing a fixed column so that the resized column's left edge
    // stays put instead of the name column shrinking underneath it.
    if (key !== "name" && colWidths.name == null) {
      const nameHeader = document.querySelector<HTMLElement>('[data-list-header="name"]');
      const measured = nameHeader?.getBoundingClientRect().width;
      if (measured && measured > 0) {
        setColWidths((previous) => ({ ...previous, name: Math.round(measured) }));
      }
    }

    const minWidth = key === "name" ? 220 : 60;
    const maxWidth = key === "name" ? 1200 : 400;
    const onMove = (moveEvent: MouseEvent) => {
      const width = Math.min(maxWidth, Math.max(minWidth, startW + moveEvent.clientX - startX));
      setColWidths((previous) => ({ ...previous, [key]: width }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const gripMouseDown = (event: React.MouseEvent, key: string) => {
    event.stopPropagation();
    startResize(event, key);
  };

  const headerMouseDown = (event: React.MouseEvent, key: string) => {
    if (key === "name") return;
    if ((event.target as HTMLElement).closest('[title="ドラッグで列幅を変更"],div.z-40,input,select,textarea')) return;
    // The right edge belongs to the resize handle. Without this guard a
    // slightly missed resize grab becomes a column reorder.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX >= rect.right - 10) return;
    colDragCand.current = { key, x: event.clientX };
  };

  const headerMouseUp = (key: string) => {
    if (colDragging && key !== "name" && key !== colDragging) {
      const visible = [...visibleCols];
      const from = visible.indexOf(colDragging);
      const to = visible.indexOf(key);
      if (from >= 0 && to >= 0) {
        visible.splice(to, 0, ...visible.splice(from, 1));
        setColOrder([...visible, ...colOrder.filter((k) => !visible.includes(k))]);
        onMenuClose();
      }
    }
    colDragCand.current = null;
    setColDragging(null);
    setColDropOver(null);
  };

  const moveCol = (key: string, direction: -1 | 1) => {
    const visible = [...visibleCols];
    const index = visible.indexOf(key);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= visible.length) return;
    [visible[index], visible[next]] = [visible[next], visible[index]];
    setColOrder([...visible, ...colOrder.filter((k) => !visible.includes(k))]);
    onMenuClose();
  };

  return {
    colWidths,
    setColWidths,
    colOrder,
    colDragging,
    colDropOver,
    setColDropOver,
    visibleCols,
    gridCols,
    compactCells,
    gripMouseDown,
    headerMouseDown,
    headerMouseUp,
    moveCol,
  };
}
