"use client";

/**
 * Footer entry point for the inline section draft at the end of the list.
 *
 * The list variant is laid out exactly like a section heading row (38px tall,
 * same left inset, the ＋ in the chevron slot and the label where section
 * names start), so the draft heading that replaces it appears where the user
 * clicked instead of jumping up and to the right.
 */
export default function ListSectionAdd({
  onStart,
  compact = false,
}: {
  onStart: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="px-3 pb-3 pt-2">
        <button
          type="button"
          data-add-section-open
          onClick={onStart}
          className="text-left text-sm text-muted hover:text-text"
        >
          ＋ セクションを追加
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-[38px] items-center pl-6" id="custom-field-add" data-list-section-add-row>
      <button
        type="button"
        data-add-section-open
        onClick={onStart}
        aria-label="＋ セクションを追加"
        className="group/section-add flex h-7 items-center gap-2 rounded pr-2 text-left text-[14px] text-muted hover:text-text"
      >
        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center text-[15px] leading-none">
          ＋
        </span>
        <span>セクションを追加</span>
      </button>
    </div>
  );
}
