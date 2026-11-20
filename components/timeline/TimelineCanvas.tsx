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
    <div ref={scrollRef} className="timeline-scroll flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div
        className="relative w-full flex-1 cursor-copy bg-bg"
        style={{
          minWidth: Math.max(700, span * dayWidth),
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
