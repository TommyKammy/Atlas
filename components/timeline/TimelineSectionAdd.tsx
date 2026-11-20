"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { useSectionDraft } from "@/lib/use-section-draft";
import SectionDraftInput from "../sections/SectionDraftInput";

export type TimelineSectionAddHandle = { start: () => void };

/** Inline section row at the bottom of the timeline sidebar. */
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sectionDraft = useSectionDraft({ projectId, onCreated: () => onCreated() });

  const start = () => {
    sectionDraft.start(null);
    requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: "nearest" });
    });
  };
  useImperativeHandle(ref, () => ({ start }));

  return (
    <div ref={containerRef} data-timeline-section-add>
      {sectionDraft.active ? (
        <div
          data-timeline-section-draft
          className="relative flex h-10 items-center gap-1.5 pl-5 pr-2 max-md:px-1"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className="h-3 w-3 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m2.5 4.5 3.5 3 3.5-3" />
          </svg>
          <SectionDraftInput
            value={sectionDraft.name}
            onChange={sectionDraft.changeName}
            onCommit={(origin) => void sectionDraft.commit(origin)}
            onCancel={() => {
              sectionDraft.cancel();
              requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
            }}
            saving={sectionDraft.saving}
            error={sectionDraft.error}
            // Pulled left by border + padding (1px + 5px) so the typed name starts
            // where section names start and does not shift on save.
            className="-ml-1.5 h-7 min-w-0 flex-1 rounded border border-accent bg-field px-[5px] text-[13px] font-bold text-text outline-none disabled:bg-surface-subtle"
            errorClassName="absolute left-5 top-full z-20 mt-1 w-[calc(100%-1.5rem)] rounded border border-danger-line bg-surface px-2 py-1 text-[12px] text-danger shadow"
          />
        </div>
      ) : (
        // Same geometry as a section row (h-10, pl-5, the ＋ in the chevron
        // slot), so the draft row that replaces it opens where it was clicked.
        <div className="flex h-10 items-center pl-5 pr-2 max-md:px-1">
          <button
            ref={triggerRef}
            type="button"
            data-add-section-open
            onClick={start}
            aria-label="＋ セクションを追加"
            className="flex h-7 items-center gap-1.5 text-left text-[13px] text-muted hover:text-text"
          >
            <span aria-hidden className="flex h-3 w-3 shrink-0 items-center justify-center text-[13px] leading-none">＋</span>
            <span>セクションを追加</span>
          </button>
        </div>
      )}
    </div>
  );
}
