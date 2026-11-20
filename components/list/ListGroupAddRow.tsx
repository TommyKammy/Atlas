"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import type { Section } from "@/lib/data";

/** Inline composer used when adding a task to a non-section group. */
export default function ListGroupAddRow({
  draft,
  sectionValue,
  sections,
  onDraftChange,
  onSectionChange,
  onCommit,
  onCancel,
}: {
  draft: string;
  sectionValue: string | number;
  sections: Section[];
  onDraftChange: (value: string) => void;
  onSectionChange: (sectionId: number | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const commitOnBlur = (event: React.FocusEvent<HTMLElement>) => {
    const related = event.relatedTarget as HTMLElement | null;
    if (related?.closest("[data-add-task-row]")) return;
    onCommit();
  };

  return (
    <>
      <input
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") onCancel();
        }}
        onBlur={commitOnBlur}
        placeholder="タスク名を入力"
        data-add-task
        autoFocus
        className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-accent"
      />
      <select
        value={sectionValue}
        onChange={(event) => onSectionChange(event.target.value === "" ? null : Number(event.target.value))}
        onBlur={commitOnBlur}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") onCancel();
        }}
        className="rounded border px-1 py-1 text-sm"
        title="追加先セクション"
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.name}
          </option>
        ))}
      </select>
    </>
  );
}
