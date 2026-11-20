"use client";

import { useSectionAdd } from "@/lib/use-section-add";
import { useLayoutEffect, useRef } from "react";
import ListSectionAdd from "../list/ListSectionAdd";

export default function BoardSectionAdd({
  projectId,
  columnCount,
  onCreated,
}: {
  projectId: number;
  columnCount: number;
  onCreated: (sectionId: number) => void;
}) {
  const composer = useSectionAdd(projectId, onCreated);
  const containerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // A server refresh inserts the new column before this composer. Keep its
    // focused control visible whether focus was restored before or after that.
    const active = document.activeElement;
    if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [columnCount]);
  return (
    <div
      ref={containerRef}
      data-board-section-add
      className="w-[17.5rem] shrink-0 self-start pt-1"
      onFocusCapture={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
    >
      <ListSectionAdd compact {...composer} />
    </div>
  );
}
