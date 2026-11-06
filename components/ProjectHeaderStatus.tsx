"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const OPTIONS = [
  { label: "順調", color: "green" },
  { label: "リスクあり", color: "yellow" },
  { label: "要対応", color: "red" },
  { label: "保留中", color: "blue" },
  { label: "完了", color: "green" },
  { label: "撤回済み", color: "muted" },
] as const;

const DOT: Record<string, string> = {
  green: "bg-green-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
  blue: "bg-blue-600",
  muted: "bg-neutral-400",
  none: "border border-neutral-400 bg-transparent",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status || status === "active" || status === "none") return "";
  return status;
}

export default function ProjectHeaderStatus({
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
  const [status, setStatus] = useState(statusLabel(initialStatus));
  const [color, setColor] = useState(initialColor ?? "none");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = status || "ステータスを設定";

  const select = async (nextStatus: string, nextColor: string) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, status_color: nextColor }),
      });
      if (!res.ok) {
        alert(`ステータスの更新に失敗しました: ${res.status}`);
        return;
      }
      setStatus(nextStatus === "撤回済み" ? "撤回済み" : nextStatus);
      setColor(nextColor);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[color] ?? DOT.none}`} />
      <span className={status ? "" : "text-neutral-500"}>{label}</span>
      {canEdit && <span className="text-[10px] text-neutral-400">▾</span>}
    </>
  );

  if (!canEdit) {
    return (
      <span
        data-project-status-button
        data-project-status-current={status}
        aria-label={status ? `現在のステータス: ${status}` : "ステータス未設定"}
        className="ml-1 hidden h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-neutral-600 lg:inline-flex"
      >
        {body}
      </span>
    );
  }

  return (
    <span className="relative ml-1 hidden lg:inline-flex">
      <button
        type="button"
        data-project-status-button
        data-project-status-current={status}
        aria-label={status ? `現在のステータス: ${status}` : "ステータスを設定"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
      >
        {body}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            data-project-status-menu
            className="absolute top-8 left-0 z-40 w-52 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg"
          >
            {OPTIONS.map((option) => (
              <button
                key={`${option.label}-${option.color}`}
                type="button"
                data-project-status-option={option.label}
                onClick={() => void select(option.label, option.color)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
              >
                <span className={`h-3 w-3 rounded-full ${DOT[option.color]}`} />
                {option.label}
                {status === option.label && <span className="ml-auto text-[11px] text-neutral-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
