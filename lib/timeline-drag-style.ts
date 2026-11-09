export type TimelineDragMode = "move" | "start" | "end";
export type TimelineDragAxis = "x" | "row" | null;

export type TimelineBarDragStyle = {
  transform?: string;
  left?: string;
  width?: string;
};

/**
 * Visual style for a timeline bar while dragging.
 *
 * Move drags translate the whole bar. Edge drags must only change left/width
 * so the opposite edge stays fixed in real time.
 */
export function timelineBarDragStyle(input: {
  mode: TimelineDragMode;
  axis: TimelineDragAxis;
  dx: number;
  dy: number;
  x1: string;
  x2: string;
  canReorder: boolean;
}): TimelineBarDragStyle {
  const { mode, axis, dx, dy, x1, x2, canReorder } = input;
  if (axis === "row") {
    return { transform: `translateY(${dy}px)` };
  }
  if (mode === "move") {
    return {
      transform:
        axis === "x"
          ? `translateX(${dx}px)`
          : canReorder
            ? `translate(${dx}px, ${dy}px)`
            : `translateX(${dx}px)`,
    };
  }
  if (mode === "start") {
    return {
      left: `calc(${x1} + ${dx}px)`,
      width: `max(2px, calc(${x2} - ${x1} - ${dx}px))`,
    };
  }
  return {
    width: `max(2px, calc(${x2} - ${x1} + ${dx}px))`,
  };
}
