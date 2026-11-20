"use client";

import { memo } from "react";
import { isCriticalDependency } from "@/lib/timeline-display";

export type TimelineDependencyShape = {
  key: string;
  d: string;
  arrow: string;
  from: { x: number };
  y1: number;
  to: { x: number };
  y2: number;
  midX: number;
  midY: number;
  e: { task_id: number; depends_on_id: number };
};

export type TimelineDependencyDraft = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const TimelineDependencyEdge = memo(function TimelineDependencyEdge({
  shape,
  selected,
  critical,
  onHover,
  onLeave,
}: {
  shape: TimelineDependencyShape;
  selected: boolean;
  critical: boolean;
  onHover: (key: string) => void;
  onLeave: () => void;
}) {
  // Hover temporarily thickens the edge; otherwise it is a quiet 1px line
  // whose arrow shares the same color. Critical-path edges use the accent.
  const tone = selected || critical ? "var(--atlas-accent)" : "var(--atlas-line-strong)";
  return (
    <g data-timeline-dependency={shape.key} data-timeline-dependency-critical={critical ? "true" : undefined}>
      <path
        d={shape.d}
        fill="none"
        stroke={tone}
        strokeWidth={selected ? 2 : 1}
        strokeLinejoin="round"
      />
      <circle cx={shape.from.x} cy={shape.y1} r="2.5" fill={tone} />
      <path d={shape.arrow} fill={tone} />
      <path
        data-timeline-dependency-hit={shape.key}
        d={shape.d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        strokeLinejoin="round"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        tabIndex={0}
        onPointerEnter={() => onHover(shape.key)}
        onPointerLeave={onLeave}
        onFocus={() => onHover(shape.key)}
        onBlur={onLeave}
        onClick={(event) => event.stopPropagation()}
      />
    </g>
  );
});

// Draft pointer updates do not rebuild the existing dependency SVG. Hovering
// a different edge only changes the selected state of the affected edges.
const TimelineDependencyShapes = memo(function TimelineDependencyShapes({
  shapes,
  hoveredKey,
  critical,
  onHover,
  onLeave,
}: {
  shapes: TimelineDependencyShape[];
  hoveredKey: string | null;
  critical?: ReadonlySet<number>;
  onHover: (key: string) => void;
  onLeave: () => void;
}) {
  if (shapes.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-[2] h-full w-full">
      {shapes.map((shape) => (
        <TimelineDependencyEdge
          key={shape.key}
          shape={shape}
          selected={hoveredKey === shape.key}
          critical={critical ? isCriticalDependency(shape.e, critical) : false}
          onHover={onHover}
          onLeave={onLeave}
        />
      ))}
    </svg>
  );
});

function TimelineDependencyLayer({
  shapes,
  hoveredKey,
  draft,
  critical,
  onHover,
  onLeave,
  onDelete,
}: {
  shapes: TimelineDependencyShape[];
  hoveredKey: string | null;
  draft: TimelineDependencyDraft | null;
  critical?: ReadonlySet<number>;
  onHover: (key: string) => void;
  onLeave: () => void;
  onDelete: (dependency: { task_id: number; depends_on_id: number }) => void;
}) {
  const hoveredShape = hoveredKey ? shapes.find((shape) => shape.key === hoveredKey) : undefined;
  return (
    <>
      <TimelineDependencyShapes
        shapes={shapes}
        hoveredKey={hoveredKey}
        critical={critical}
        onHover={onHover}
        onLeave={onLeave}
      />
      {hoveredShape && (
        <button
          type="button"
          data-timeline-dependency-delete={hoveredShape.key}
          aria-label="依存関係を削除"
          title="依存関係を削除"
          onPointerEnter={() => onHover(hoveredShape.key)}
          onPointerLeave={onLeave}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(hoveredShape.e);
          }}
          style={{ left: hoveredShape.midX, top: hoveredShape.midY }}
          className="absolute z-[6] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-danger shadow-md hover:bg-danger-soft"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.5 7v4M9.5 7v4" />
          </svg>
        </button>
      )}
      {draft && (
        <svg className="pointer-events-none absolute inset-0 z-[4] h-full w-full">
          <path
            data-timeline-dependency-draft
            d={`M ${draft.x1} ${draft.y1} L ${draft.x2} ${draft.y2}`}
            fill="none"
            stroke="var(--atlas-accent)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
          <circle cx={draft.x1} cy={draft.y1} r="3" fill="var(--atlas-accent)" />
        </svg>
      )}
    </>
  );
}

// Scrolling changes the bar render window, not these dependency shapes.
export default memo(TimelineDependencyLayer);
