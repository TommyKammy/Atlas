"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";
import { PROJECT_STATUS_DOT_CLASSES } from "@/lib/data-colors";

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
  green: PROJECT_STATUS_DOT_CLASSES.green,
  yellow: PROJECT_STATUS_DOT_CLASSES.yellow,
  red: PROJECT_STATUS_DOT_CLASSES.red,
  blue: PROJECT_STATUS_DOT_CLASSES.blue,
  muted: PROJECT_STATUS_DOT_CLASSES.muted,
  none: "border border-line-strong bg-transparent",
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
        toastMessage(`ステータスの更新に失敗しました: ${res.status}`);
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
      <span className={status ? "" : "text-muted"}>{label}</span>
      {canEdit && <span className="text-[10px] text-subtle">▾</span>}
    </>
  );

  if (!canEdit) {
    return (
      <span
        data-project-status-button
        data-project-status-current={status}
        aria-label={status ? `現在のステータス: ${status}` : "ステータス未設定"}
        className="ml-1 hidden h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap text-secondary md:@min-[700px]:inline-flex"
      >
        {body}
      </span>
    );
  }

  return (
    <span className="relative ml-1 hidden shrink-0 whitespace-nowrap md:@min-[700px]:inline-flex">
      <button
        type="button"
        data-project-status-button
        data-project-status-current={status}
        aria-label={status ? `現在のステータス: ${status}` : "ステータスを設定"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-secondary hover:bg-hover"
      >
        {body}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            data-project-status-menu
            className="absolute top-8 left-0 z-40 w-52 rounded-lg border border-line bg-surface p-1.5 shadow-lg"
          >
            {OPTIONS.map((option) => (
              <button
                key={`${option.label}-${option.color}`}
                type="button"
                data-project-status-option={option.label}
                onClick={() => void select(option.label, option.color)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-secondary hover:bg-hover"
              >
                <span className={`h-3 w-3 rounded-full ${DOT[option.color]}`} />
                {option.label}
                {status === option.label && <span className="ml-auto text-[11px] text-subtle">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
