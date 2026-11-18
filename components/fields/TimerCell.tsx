"use client";

import { useEffect, useState } from "react";
import {
  formatDuration,
  timerSeconds,
  type CustomField,
  type CustomValue,
} from "@/lib/custom-fields";

/** Start/stop timer control with a live elapsed display. */
export default function TimerCell({
  taskId,
  field,
  value,
  onChanged,
}: {
  taskId: number;
  field: CustomField;
  value?: CustomValue;
  onChanged: () => void;
}) {
  const raw = value?.value_json;
  const running =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).running_since
      : null;
  const isRunning = typeof running === "string";
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const act = async (action: "start" | "stop" | "reset") => {
    setBusy(true);
    try {
      const res = await fetch("/api/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, field_id: field.id, action }),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-1" data-timer-cell={field.id}>
      <button
        type="button"
        disabled={busy}
        aria-label={isRunning ? "タイマーを停止" : "タイマーを開始"}
        title={isRunning ? "タイマーを停止" : "タイマーを開始"}
        onClick={(event) => {
          event.stopPropagation();
          void act(isRunning ? "stop" : "start");
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] ${
          isRunning ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-surface-muted text-secondary hover:bg-neutral-200"
        }`}
      >
        {isRunning ? "■" : "▶"}
      </button>
      <span className="truncate text-[12px] tabular-nums text-secondary">
        {formatDuration(timerSeconds(value, now), field.config ?? {})}
      </span>
    </span>
  );
}
