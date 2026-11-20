"use client";

import type { SectionCommitOrigin } from "@/lib/use-section-draft";
import { useLayoutEffect, useRef } from "react";
import SectionDraftInput from "../sections/SectionDraftInput";

type SectionDraft = {
  active: boolean;
  name: string;
  saving: boolean;
  error: string | null;
  changeName: (value: string) => void;
  commit: (origin: SectionCommitOrigin) => Promise<void>;
  cancel: () => void;
};

/** Last board column: the usual add action becomes an inline draft column. */
export default function BoardSectionAdd({
  draft,
  onStart,
}: {
  draft: SectionDraft;
  onStart: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [draft.active]);

  if (!draft.active) {
    return (
      <div
        ref={containerRef}
        data-board-section-add
        className="w-[17.5rem] shrink-0 self-start"
        onFocusCapture={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
      >
        {/* Same geometry as a column heading (px-1 pt-1 pb-2, 28px row), so the
            draft heading that replaces this button opens where it was clicked. */}
        <div className="flex items-center gap-2 px-1 pt-1 pb-2">
          <button
            ref={triggerRef}
            type="button"
            data-add-section-open
            onClick={onStart}
            className="flex h-7 items-center text-left text-[13px] text-muted hover:text-text"
          >
            ＋ セクションを追加
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-board-section-add
      data-board-section-draft
      data-board-column="draft"
      className="relative w-[17.5rem] shrink-0 self-start"
      onFocusCapture={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
    >
      <div className="relative flex items-center gap-2 px-1 pt-1 pb-2">
        <SectionDraftInput
          value={draft.name}
          onChange={draft.changeName}
          onCommit={(origin) => void draft.commit(origin)}
          onCancel={() => {
            draft.cancel();
            requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
          }}
          saving={draft.saving}
          error={draft.error}
          // Pulled left by border + padding (1px + 3px) so the typed name starts
          // where column titles start (4px in) and does not shift on save.
          className="-ml-1 h-7 min-w-0 flex-1 rounded border border-accent bg-field px-[3px] text-[13px] font-bold text-text outline-none disabled:bg-surface-subtle"
          errorClassName="absolute left-1 top-full z-20 mt-1 w-full rounded border border-danger-line bg-surface px-2 py-1 text-[12px] text-danger shadow"
        />
        <span className="shrink-0 text-[12px] font-normal text-muted">0</span>
        <button
          type="button"
          disabled
          aria-label="新しいセクションにタスクを追加"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none text-muted disabled:opacity-40"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
