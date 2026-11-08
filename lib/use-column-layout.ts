"use client";

import { useEffect, useLayoutEffect, useState } from "react";

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
  const [colDropSide, setColDropSide] = useState<"before" | "after" | null>(null);
  const [isCompact, setIsCompact] = useState(false);

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

  const endColumnDrag = () => {
    setColDragging(null);
    setColDropOver(null);
    setColDropSide(null);
  };

  const clearColumnDrop = () => {
    setColDropOver(null);
    setColDropSide(null);
  };

  const startColumnDrag = (event: React.DragEvent, key: string, label: string) => {
    if (key === "name") {
      event.preventDefault();
      return;
    }
    if (
      (event.target as HTMLElement).closest(
        'button[title="列メニュー"],input,select,textarea,[title="ドラッグで列幅を変更"],div.z-40',
      )
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);

    // Build a dedicated drag image from the header label. Hiding the source
    // header before the browser snapshots it would otherwise produce a blank
    // (or neighbouring-cell) drag image. This mirrors Asana's
    // DragLayer-previewContainer: a standalone field-shaped preview.
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    const computed = window.getComputedStyle(source);
    const dragImage = document.createElement("div");
    dragImage.textContent = label;
    Object.assign(dragImage.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: "flex",
      alignItems: "center",
      padding: "0 8px",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      boxSizing: "border-box",
      background: "rgba(255, 255, 255, 0.9)",
      border: "1px solid #e1e1e1",
      borderRadius: "3px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      opacity: "0.8",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.body.appendChild(dragImage);
    event.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
    window.setTimeout(() => dragImage.remove(), 0);

    setColDragging(key);
    setColDropOver(null);
    setColDropSide(null);
    onMenuClose();
  };

  const dragOverColumn = (event: React.DragEvent, key: string) => {
    if (!colDragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (key === "name" || key === colDragging) {
      clearColumnDrop();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setColDropOver(key);
    setColDropSide(event.clientX < rect.left + rect.width / 2 ? "before" : "after");
  };

  const dragLeaveColumn = (event: React.DragEvent, key: string) => {
    if (colDropOver !== key) return;
    const related = event.relatedTarget as Node | null;
    if (related && (event.currentTarget as HTMLElement).contains(related)) return;
    clearColumnDrop();
  };

  const dropColumn = (event: React.DragEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const source = colDragging;
    if (source && source !== key && key !== "name") {
      const visible = [...visibleCols];
      const from = visible.indexOf(source);
      const to = visible.indexOf(key);
      if (from >= 0 && to >= 0) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
        const [moved] = visible.splice(from, 1);
        let insert = to;
        if (from < to) insert -= 1;
        if (side === "after") insert += 1;
        visible.splice(insert, 0, moved);
        setColOrder([...visible, ...colOrder.filter((k) => !visible.includes(k))]);
        onMenuClose();
      }
    }
    endColumnDrag();
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
    colDropSide,
    visibleCols,
    gridCols,
    compactCells,
    gripMouseDown,
    startColumnDrag,
    dragOverColumn,
    dragLeaveColumn,
    dropColumn,
    clearColumnDrop,
    endColumnDrag,
    moveCol,
  };
}
