"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { useSectionAdd } from "@/lib/use-section-add";
import ListSectionAdd from "../list/ListSectionAdd";

export type TimelineSectionAddHandle = { start: () => void };

/** Keep typing in the section composer from re-rendering the timeline's bars. */
export default function TimelineSectionAdd({
  projectId,
  onCreated,
  ref,
}: {
  projectId: number;
  onCreated: () => void;
  ref: Ref<TimelineSectionAddHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const composer = useSectionAdd(projectId, onCreated);

  const start = () => {
    composer.onStart();
    containerRef.current?.querySelector<HTMLInputElement>("[data-add-section-input]")?.focus();
  };
  useImperativeHandle(ref, () => ({ start }));

  return (
    <div ref={containerRef} data-timeline-section-add>
      <ListSectionAdd
        compact
        {...composer}
        onStart={start}
      />
    </div>
  );
}
