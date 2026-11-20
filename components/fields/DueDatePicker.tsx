"use client";

import { isImeComposing } from "@/lib/ime-keyboard";
import {
  initialDateRangeField,
  pickDateRangeDay,
  type DateRangeField,
} from "@/lib/date-range-pick";

import { useEffect, useRef, useState } from "react";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function parseISODate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function formatShortDate(iso: string) {
  if (!iso) return "";
  const { y, m, d } = parseISODate(iso);
  return `${m}/${d}/${String(y).slice(-2)}`;
}

function parseShortDate(text: string): string | null {
  const value = text.trim();
  if (value === "") return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  };
  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  const md = value.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
  if (!md) return null;
  const m = Number(md[1]);
  const d = Number(md[2]);
  let y = md[3] ? Number(md[3]) : new Date().getFullYear();
  if (y < 100) y += 2000;
  return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

function addDaysISO(iso: string, days: number) {
  const { y, m, d } = parseISODate(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStartISO(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonthISO(month: string, delta: number) {
  const { y, m } = parseISODate(month);
  const total = y * 12 + (m - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12 + 12) % 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

function monthTitle(month: string) {
  const { y, m } = parseISODate(month);
  return `${y}年 ${m}月`;
}

function monthCells(month: string) {
  const offset = new Date(`${month}T00:00:00Z`).getUTCDay();
  const first = addDaysISO(month, -offset);
  const key = month.slice(0, 7);
  return Array.from({ length: 42 }, (_, index) => {
    const iso = addDaysISO(first, index);
    return { iso, inMonth: iso.slice(0, 7) === key };
  });
}

/** Asana-style start/due range picker with a month calendar. */
export default function DueDatePicker({
  start,
  due,
  today,
  onApply,
  onCancel,
}: {
  start: string;
  due: string;
  today: string;
  onApply: (start: string, due: string) => void;
  onCancel: () => void;
}) {
  const [startText, setStartText] = useState(() => formatShortDate(start));
  const [dueText, setDueText] = useState(() => formatShortDate(due));
  const [activeField, setActiveField] = useState<DateRangeField>(() => initialDateRangeField(start, due));
  const [viewMonth, setViewMonth] = useState(() => monthStartISO(due || start || today));
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const width = 308;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const openAbove = window.innerHeight - rect.bottom < 430;
    setPosition({
      left,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, []);

  const applyRange = (nextStart: string, nextDue: string) => {
    let normalizedDue = nextDue;
    if (nextStart && normalizedDue && nextStart > normalizedDue) {
      normalizedDue = nextStart;
    }
    setStartText(formatShortDate(nextStart));
    setDueText(formatShortDate(normalizedDue));
    onApply(nextStart, normalizedDue);
  };

  const commitInputs = () => {
    const nextStart = parseShortDate(startText);
    const nextDue = parseShortDate(dueText);
    if (nextStart === null || nextDue === null) return false;
    if (nextStart !== start || nextDue !== due) applyRange(nextStart, nextDue);
    return true;
  };

  const close = () => {
    commitInputs();
    onCancel();
  };

  const pickDay = (iso: string) => {
    const parsedStart = parseShortDate(startText);
    const parsedDue = parseShortDate(dueText);
    const baseStart = parsedStart === null ? start : parsedStart;
    const baseDue = parsedDue === null ? due : parsedDue;
    const next = pickDateRangeDay(activeField, baseStart, baseDue, iso);
    setViewMonth(monthStartISO(iso));
    setActiveField(next.active);
    setStartText(formatShortDate(next.start));
    setDueText(formatShortDate(next.due));
    onApply(next.start, next.due);
  };

  const clearRange = () => {
    setStartText("");
    setDueText("");
    onApply("", "");
  };

  const clearStart = () => {
    const nextDue = parseShortDate(dueText) ?? due;
    setActiveField(nextDue === "" ? "start" : "due");
    applyRange("", nextDue);
  };

  const clearDue = () => {
    applyRange(parseShortDate(startText) ?? start, "");
  };

  const rangeText =
    start && due
      ? `${formatShortDate(start)} – ${formatShortDate(due)}`
      : formatShortDate(due || start);

  const cells = monthCells(viewMonth);

  return (
    <span ref={rootRef} data-due-picker className="relative z-[140] min-w-0">
      <span data-due-summary className="flex h-8 w-full min-w-0 items-center truncate rounded border border-accent bg-surface px-2 text-[12px] text-secondary">
        {rangeText || "期日"}
      </span>
      {position && (
        <>
          <div className="fixed inset-0 z-[139]" onClick={close} />
          <div
            data-due-menu
            data-due-active-field={activeField}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            className="fixed z-[140] w-[308px] rounded-lg border border-line bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            style={{
              left: position.left,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }}
          >
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  autoFocus={activeField === "start"}
                  value={startText}
                  onChange={(event) => setStartText(event.target.value)}
                  onFocus={() => setActiveField("start")}
                  data-due-field="start"
                  data-due-active={activeField === "start" ? "true" : undefined}
                  onKeyDown={(event) => {
                    if (isImeComposing(event)) return;
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (commitInputs()) onCancel();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      close();
                    }
                  }}
                  placeholder="開始日"
                  aria-label="開始日"
                  spellCheck={false}
                  className={`h-8 w-full rounded border px-2 pr-6 text-[12px] text-text outline-none ${
                    activeField === "start" ? "border-accent" : "border-field-line"
                  }`}
                />
                {startText && (
                  <button
                    type="button"
                    aria-label="開始日をクリア"
                    onClick={clearStart}
                    className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-subtle hover:bg-hover hover:text-secondary"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="relative min-w-0 flex-1">
                <input
                  autoFocus={activeField === "due"}
                  value={dueText}
                  onChange={(event) => setDueText(event.target.value)}
                  onFocus={() => setActiveField("due")}
                  data-due-field="due"
                  data-due-active={activeField === "due" ? "true" : undefined}
                  onKeyDown={(event) => {
                    if (isImeComposing(event)) return;
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (commitInputs()) onCancel();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      close();
                    }
                  }}
                  placeholder="期日"
                  aria-label="期日"
                  spellCheck={false}
                  className={`h-8 w-full rounded border px-2 pr-6 text-[12px] text-text outline-none ${
                    activeField === "due" ? "border-accent" : "border-field-line"
                  }`}
                />
                {dueText && (
                  <button
                    type="button"
                    aria-label="期日をクリア"
                    onClick={clearDue}
                    className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-subtle hover:bg-hover hover:text-secondary"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="前月"
                onClick={() => setViewMonth((current) => shiftMonthISO(current, -1))}
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover"
              >
                ‹
              </button>
              <span className="text-[13px] font-medium text-secondary">{monthTitle(viewMonth)}</span>
              <button
                type="button"
                aria-label="翌月"
                onClick={() => setViewMonth((current) => shiftMonthISO(current, 1))}
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover"
              >
                ›
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[10px] text-muted">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="flex h-4 items-center justify-center">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-2">
              {cells.map(({ iso, inMonth }) => {
                const selectedStart = iso === start;
                const selectedDue = iso === due;
                const selected = selectedStart || selectedDue;
                const inRange = Boolean(start && due && start < iso && iso < due);
                const isToday = iso === today;
                return (
                  <button
                    key={iso}
                    type="button"
                    data-due-day={iso}
                    onClick={() => pickDay(iso)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] ${
                      selected
                        ? "bg-accent font-medium text-on-accent"
                        : inRange
                          ? "bg-accent-soft text-accent-text"
                          : inMonth
                            ? "text-secondary hover:bg-hover"
                            : "text-subtle hover:bg-hover"
                    } ${!selected && isToday ? "ring-1 ring-accent" : ""}`}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <span className="text-[11px] text-subtle">期間を選択</span>
              <button
                type="button"
                data-due-clear
                onClick={clearRange}
                className="rounded px-2 py-1 text-[12px] text-secondary hover:bg-hover"
              >
                クリア
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}
