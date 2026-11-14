"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import {
  clampSidebarWidth, sidebarMaxWidth, SIDEBAR_CONTENT_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH_COOKIE,
} from "@/lib/sidebar-width";

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  originalWidth: number;
  viewportWidth: number;
  handle: HTMLDivElement;
  cursor: string;
  userSelect: string;
};

export default function ResizableSidebar({ children, collapsed, initialWidth }: {
  children: ReactNode;
  collapsed: boolean;
  initialWidth: number;
}) {
  const [width, setWidth] = useState(initialWidth);
  const [maxWidth, setMaxWidth] = useState(SIDEBAR_MAX_WIDTH);
  const [resizing, setResizing] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const widthRef = useRef(initialWidth);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef(initialWidth);

  const updateWidth = useCallback((next: number) => {
    widthRef.current = next;
    setWidth(next);
  }, []);

  const saveWidth = (next: number) => {
    document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  const finishDrag = useCallback((commit: boolean, finalWidth?: number) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const next = commit ? (finalWidth ?? pending.current) : current.originalWidth;
    updateWidth(next);
    if (commit) saveWidth(next);
    document.documentElement.style.cursor = current.cursor;
    document.body.style.userSelect = current.userSelect;
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    setResizing(false);
  }, [updateWidth]);

  useEffect(() => {
    const resize = () => {
      finishDrag(false);
      setMaxWidth(sidebarMaxWidth(window.innerWidth));
    };
    const cancel = () => finishDrag(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        finishDrag(false);
      }
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      finishDrag(false);
    };
  }, [finishDrag]);

  useEffect(() => {
    if (collapsed) finishDrag(false);
  }, [collapsed, finishDrag]);

  const dragWidth = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current!;
    return clampSidebarWidth(current.startWidth + event.clientX - current.startX, sidebarMaxWidth(window.innerWidth));
  };

  const resetWidth = () => {
    finishDrag(false);
    updateWidth(SIDEBAR_DEFAULT_WIDTH);
    saveWidth(SIDEBAR_DEFAULT_WIDTH);
  };

  return (
    <aside
      ref={aside}
      data-sidebar
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      data-sidebar-resizing={resizing ? "true" : undefined}
      style={{ width: collapsed ? 65 : width, maxWidth: collapsed ? undefined : `max(${SIDEBAR_MIN_WIDTH}px, calc(100vw - ${SIDEBAR_CONTENT_MIN_WIDTH}px))` }}
      className={`relative z-30 hidden shrink-0 border-r border-[#505050] bg-[#262626] text-neutral-200 [-webkit-font-smoothing:auto] md:flex ${resizing ? "" : "transition-[width] duration-150 motion-reduce:transition-none"}`}
    >
      {children}
      {!collapsed && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="サイドバーの幅を変更"
          aria-controls="atlas-sidebar-content"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.min(width, maxWidth)}
          aria-valuetext={`${Math.min(width, maxWidth)}ピクセル`}
          title="ドラッグで幅を変更、ダブルクリックで標準幅に戻す"
          data-sidebar-resize
          className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || drag.current) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId, startX: event.clientX,
              startWidth: aside.current!.getBoundingClientRect().width, originalWidth: widthRef.current,
              viewportWidth: window.innerWidth,
              handle: event.currentTarget, cursor: document.documentElement.style.cursor,
              userSelect: document.body.style.userSelect,
            };
            pending.current = widthRef.current;
            document.documentElement.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            setResizing(true);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            if (drag.current.viewportWidth !== window.innerWidth) { finishDrag(false); return; }
            pending.current = dragWidth(event);
            if (frame.current === null) frame.current = requestAnimationFrame(() => {
              frame.current = null;
              updateWidth(pending.current);
            });
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            // The resize event may be delivered after pointerup; never save a
            // placement computed against the previous viewport in that gap.
            if (drag.current.viewportWidth !== window.innerWidth) finishDrag(false);
            else finishDrag(true, dragWidth(event));
          }}
          onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) finishDrag(false); }}
          onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) finishDrag(false); }}
          onDoubleClick={resetWidth}
          onKeyDown={(event) => {
            if (drag.current) return;
            const current = Math.min(widthRef.current, maxWidth);
            const step = event.shiftKey ? 50 : 10;
            const next = event.key === "ArrowLeft" ? current - step : event.key === "ArrowRight" ? current + step
              : event.key === "Home" ? SIDEBAR_MIN_WIDTH : event.key === "End" ? maxWidth
                : event.key === "Enter" ? SIDEBAR_DEFAULT_WIDTH : null;
            if (next === null) return;
            event.preventDefault();
            const clamped = clampSidebarWidth(next, maxWidth);
            updateWidth(clamped);
            saveWidth(clamped);
          }}
        >
          <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:bg-blue-500 group-focus-visible:w-0.5 group-focus-visible:bg-blue-500 ${resizing ? "bg-blue-500" : "bg-transparent"}`} />
        </div>
      )}
    </aside>
  );
}
