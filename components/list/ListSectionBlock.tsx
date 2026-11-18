"use client";

import type { DragEvent, ReactNode } from "react";

/**
 * Section wrapper that owns the section drop indicator and drag targets.
 * The actual reorder/append work stays with the caller via the drag props.
 */
export default function ListSectionBlock({
  sectionId,
  collapsed,
  dropSide,
  onDragOver,
  onDragLeave,
  onDrop,
  header,
  children,
}: {
  sectionId: number;
  collapsed: boolean;
  dropSide: "before" | "after" | null;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-list-section-block={sectionId}
      className="relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropSide && (
        <span
          data-section-drop-indicator={dropSide}
          className={`pointer-events-none absolute inset-x-0 z-20 h-[2px] bg-accent ${
            dropSide === "before" ? "top-0" : "bottom-0"
          }`}
        />
      )}
      {header}
      {!collapsed && children}
    </div>
  );
}
