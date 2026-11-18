"use client";

import type { ReactNode, RefObject } from "react";

export default function TimelineCanvas({
  scrollRef,
  contentRef,
  min,
  span,
  dayWidth,
  onPointerDown,
  onClick,
  onPointerMove,
  onPointerLeave,
  children,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  min: number;
  span: number;
  dayWidth: number;
  onPointerDown: () => void;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  children: ReactNode;
}) {
  return (
    <div ref={scrollRef} className="timeline-scroll min-w-0 flex-1 overflow-x-auto">
      <div
        className="relative w-full cursor-copy bg-surface-muted"
        style={{
          minWidth: Math.max(700, span * dayWidth),
          minHeight: "max(520px, calc(100vh - 178px))",
        }}
        ref={contentRef}
        data-timeline-canvas
        data-timeline-min={min}
        data-timeline-span={span}
        data-timeline-day-width={dayWidth}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {children}
      </div>
    </div>
  );
}
