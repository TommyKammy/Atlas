"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MAIN = [
  { label: "順調", color: "green", dot: "bg-green-600" },
  { label: "リスクあり", color: "yellow", dot: "bg-amber-500" },
  { label: "要対応", color: "red", dot: "bg-red-600" },
] as const;
const MORE = [
  { label: "保留中", color: "blue", dot: "bg-blue-600" },
  { label: "完了", color: "green", dot: "bg-green-600" },
  { label: "撤回済み", color: "muted", dot: "bg-neutral-400" },
] as const;

export default function ProjectStatusQuick({
  projectId,
  initialStatus,
  initialColor,
  canEdit,
}: {
  projectId: number;
  initialStatus: string | null;
  initialColor: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const initial = !initialStatus || initialStatus === "active" ? "" : initialStatus;
  const [status, setStatus] = useState(initial);
  const [color, setColor] = useState(initialColor ?? "none");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = async (label: string, nextColor: string) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: label, status_color: nextColor }),
      });
      if (!res.ok) {
        toastMessage(`ステータスの更新に失敗しました: ${res.status}`);
        return;
      }
      setStatus(label);
      setColor(nextColor);
      setMore(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const dot =
    color === "green"
      ? "bg-green-600"
      : color === "yellow"
        ? "bg-amber-500"
        : color === "red"
          ? "bg-red-600"
          : color === "blue"
            ? "bg-blue-600"
            : "bg-neutral-400";

  return (
    <div data-overview-status className="mt-3">
      {status && (
        <div data-overview-status-current={status} className="mb-2 flex items-center gap-2 text-sm text-secondary">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          現在: {status}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {MAIN.map((option) => (
          <button
            key={option.label}
            type="button"
            data-overview-status-option={option.label}
            disabled={!canEdit || busy}
            onClick={() => void update(option.label, option.color)}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] disabled:opacity-60 ${
              status === option.label ? "border-blue-500 bg-blue-50" : "bg-surface hover:bg-neutral-50"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${option.dot}`} />
            {option.label}
          </button>
        ))}
        <span className="relative">
          <button
            type="button"
            data-overview-status-more
            aria-label="その他のステータス"
            onClick={() => setMore((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-surface text-muted hover:bg-neutral-50"
          >
            ⋯
          </button>
          {more && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMore(false)} />
              <div data-overview-status-menu className="absolute top-9 right-0 z-40 w-44 rounded-lg border bg-surface p-1 shadow-lg">
                {MORE.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    data-overview-status-option={option.label}
                    onClick={() => void update(option.label, option.color)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-neutral-100"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${option.dot}`} />
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
