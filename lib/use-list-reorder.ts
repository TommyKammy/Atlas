"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import type { RelativePlacement } from "./list-order";

type Target = { id: number; placement: RelativePlacement };
type Drag = { id: number; pointerId: number; title: string; startX: number; startY: number; x: number; y: number; active: boolean; target: Target | null };

/** Handles live in rows marked data-reorder-id, within a data-reorder-scroll container. */
export function useListReorder({ ids, disabled, onMove, includeTrailingSpace = false }: {
  ids: number[]; disabled: boolean; onMove: (id: number, target: number, placement: RelativePlacement) => void;
  /** The list owns the scroll container's trailing padding (no sections below). */
  includeTrailingSpace?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = drag !== null;
  const cancel = useCallback(() => { current.current = null; setDrag(null); }, []);
  const targetAt = useCallback((x: number, y: number): Target | null => {
    const list = listRef.current;
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    const viewport = (list.closest("[data-reorder-scroll]") ?? list).getBoundingClientRect();
    // Never target other sections of a shared scroll container (e.g. recents).
    if (x < Math.max(bounds.left, viewport.left) || x > Math.min(bounds.right, viewport.right) ||
      y < Math.max(bounds.top, viewport.top) || y > (includeTrailingSpace ? viewport.bottom : Math.min(bounds.bottom, viewport.bottom))) return null;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-reorder-id]"));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.bottom) return { id: Number(row.dataset.reorderId), placement: y < rect.top + rect.height / 2 ? "before" : "after" };
    }
    const last = rows.at(-1);
    return last ? { id: Number(last.dataset.reorderId), placement: "after" } : null;
  }, [includeTrailingSpace]);
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    let frame = 0, lastTime = 0;
    const scroll = (time: number) => {
      const item = current.current, list = listRef.current;
      const scroller = list?.closest<HTMLElement>("[data-reorder-scroll]") ?? list;
      if (item?.active && scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (item.x >= bounds.left && item.x <= bounds.right && item.y >= bounds.top && item.y <= bounds.bottom) {
          const speed = item.y < bounds.top + 36 ? -Math.min(1, (bounds.top + 36 - item.y) / 36)
            : item.y > bounds.bottom - 36 ? Math.min(1, (item.y - bounds.bottom + 36) / 36) : 0;
          const before = scroller.scrollTop;
          scroller.scrollTop += speed * Math.min(time - (lastTime || time), 32) * 0.5;
          if (before !== scroller.scrollTop) {
            const next = { ...item, target: targetAt(item.x, item.y) };
            current.current = next; setDrag(next);
          }
        }
      }
      lastTime = time; frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel);
    };
  }, [dragging, targetAt, cancel]);

  const handleProps = (id: number, title: string): ButtonHTMLAttributes<HTMLButtonElement> => ({
    type: "button", "aria-disabled": disabled || ids.length < 2,
    "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
    title: "ドラッグして並べ替え（Alt + ↑ / ↓）",
    style: { touchAction: "none", cursor: disabled || ids.length < 2 ? "default" : drag?.id === id ? "grabbing" : "grab" },
    onPointerDown: event => {
      if (disabled || ids.length < 2 || event.button !== 0 || !event.isPrimary || current.current) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      const item: Drag = { id, pointerId: event.pointerId, title, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null };
      current.current = item; setDrag(item);
    },
    onPointerMove: event => {
      const item = current.current;
      if (!item || event.pointerId !== item.pointerId) return;
      const active = item.active || Math.hypot(event.clientX - item.startX, event.clientY - item.startY) > 5;
      const next = { ...item, x: event.clientX, y: event.clientY, active, target: active ? targetAt(event.clientX, event.clientY) : null };
      current.current = next; setDrag(next);
    },
    onPointerCancel: event => { if (event.pointerId === current.current?.pointerId) cancel(); },
    onLostPointerCapture: event => { if (event.pointerId === current.current?.pointerId) cancel(); },
    onPointerUp: event => {
      const item = current.current;
      if (!item || item.pointerId !== event.pointerId) return;
      const target = targetAt(event.clientX, event.clientY);
      cancel();
      if (!disabled && item.active && target && item.id !== target.id && ids.includes(item.id) && ids.includes(target.id)) onMove(item.id, target.id, target.placement);
    },
    onKeyDown: event => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      if (disabled || current.current) return;
      const index = ids.indexOf(id);
      const target = ids[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (index !== -1 && target !== undefined) onMove(id, target, event.key === "ArrowUp" ? "before" : "after");
    },
  });
  return { listRef, drag, handleProps };
}
