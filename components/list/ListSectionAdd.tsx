"use client";

/** Footer entry point for the inline section draft at the end of the list. */
export default function ListSectionAdd({
  onStart,
  compact = false,
}: {
  onStart: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "px-3 pb-3 pt-2" : "pt-4"} id={compact ? undefined : "custom-field-add"}>
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
