"use client";

import { useEffect, useRef, useState } from "react";
import { dueSegs } from "@/lib/dates";

/** Compact Asana-style due-date control with a small date popover. */
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [a, b] = dueSegs(start, due);
  const label = a ? (b ? `${a} – ${b}` : a) : "期日なし";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 min-w-0 items-center gap-1.5 rounded px-1 text-[13px] ${
          overdue ? "font-medium text-red-700" : "text-neutral-800"
        } hover:bg-neutral-100`}
        aria-label="期日を設定"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.3">
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
          className="ml-0.5 rounded p-0.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ×
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-[130] mt-1 w-[280px] rounded-lg border border-neutral-200 bg-white p-3 shadow-xl">
          <div className="text-[11px] font-semibold text-neutral-500">期日</div>
          <label className="mt-2 block text-[11px] text-neutral-500">
            開始日
            <input
              type="date"
              value={start ?? ""}
              onChange={(event) => onPatch({ start_on: event.target.value || null })}
              className="mt-0.5 h-8 w-full rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
            />
          </label>
          <label className="mt-2 block text-[11px] text-neutral-500">
            期日
            <input
              type="date"
              value={due ?? ""}
              onChange={(event) => onPatch({ due_on: event.target.value || null })}
              className="mt-0.5 h-8 w-full rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
            />
          </label>
          <div className="mt-2 flex justify-between">
            <button
              type="button"
              onClick={() => {
                onPatch({ start_on: null, due_on: null });
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100"
            >
              クリア
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded bg-[#2f6fd0] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#2459ad]"
            >
              完了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
