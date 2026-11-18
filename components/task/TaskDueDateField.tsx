"use client";

import { useState } from "react";
import { dueSegs, todayISO } from "@/lib/dates";
import DueDatePicker from "../fields/DueDatePicker";

/** Asana-style due-date field for the task detail pane. */
export default function TaskDueDateField({
  start,
  due,
  overdue,
  onPatch,
}: {
  start: string | null;
  due: string | null;
  overdue: boolean;
  onPatch: (fields: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [a, b] = dueSegs(start, due);
  const label = a ? (b ? `${a} – ${b}` : a) : "期日なし";

  if (open) {
    return (
      <div className="min-w-0">
        <DueDatePicker
          start={start ?? ""}
          due={due ?? ""}
          today={todayISO()}
          onApply={(nextStart, nextDue) =>
            onPatch({
              start_on: nextStart === "" ? null : nextStart,
              due_on: nextDue === "" ? null : nextDue,
            })
          }
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="inline-flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex h-7 min-w-0 items-center gap-1.5 rounded px-1 text-[13px] ${
          overdue ? "font-medium text-red-700" : "text-text"
        } hover:bg-hover`}
        aria-label="期日を設定"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
          <path d="M5 2v3M11 2v3M2.5 6.5h11" />
        </svg>
        <span className="truncate">{label}</span>
      </button>
      {(start || due) && (
        <button
          type="button"
          onClick={() => onPatch({ start_on: null, due_on: null })}
          aria-label="期日をクリアする"
          title="期日をクリアする"
          className="ml-0.5 rounded p-0.5 text-[12px] text-subtle hover:bg-hover hover:text-secondary"
        >
          ×
        </button>
      )}
    </div>
  );
}
