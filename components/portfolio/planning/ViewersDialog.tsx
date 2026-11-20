"use client";

import { useEffect, useRef, useState } from "react";
import { confirmAction } from "@/lib/ui-feedback";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
  Notice,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import { formatMonthDay } from "@/lib/planning/format";
import type { PlanningViewer, PlanningViewerCandidate } from "@/lib/planning/types";

export default function ViewersDialog({
  open,
  onClose,
  viewers,
  candidates,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  viewers: PlanningViewer[];
  candidates: PlanningViewerCandidate[];
  onAdd: (userId: number) => Promise<void>;
  onRemove: (userId: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setSelected("");
    setBusy(false);
    setError("");
  }, [open]);

  const available = candidates.filter(
    (candidate) => !viewers.some((viewer) => viewer.id === candidate.id),
  );

  const add = async () => {
    const userId = Number(selected);
    if (!Number.isInteger(userId) || userId <= 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(userId);
      setSelected("");
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (viewer: PlanningViewer) => {
    if (busy) return;
    const ok = await confirmAction(
      `「${viewer.name}」を投資計画の閲覧者から外しますか？\nこのユーザーは投資計画を開けなくなります。`,
      { title: "閲覧者を外す", confirmLabel: "外す" },
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await onRemove(viewer.id);
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlanningDialog
      open={open}
      onClose={onClose}
      title="投資計画の閲覧者"
      footer={
        <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
          閉じる
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-secondary">
          所有者とワークスペース管理者は常に閲覧・編集できます。ここで明示的に追加した閲覧者は、投資計画の内容を閲覧できますが編集・採用はできません。
        </p>
        <Notice tone="info">
          閲覧者にも元プロジェクトの閲覧権限は別途必要です。閲覧できない元プロジェクトに紐づく案件がある場合、その案件と合計・比較は表示されません。
        </Notice>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${labelClass} min-w-52 flex-1`}>
            閲覧者を追加
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className={`${inputClass} mt-1`}
              disabled={busy || available.length === 0}
            >
              <option value="">ユーザーを選択…</option>
              {available.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.email ? `（${candidate.email}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void add()}
            className={buttonPrimary}
            disabled={busy || selected === ""}
          >
            {busy ? "更新中…" : "閲覧者に追加"}
          </button>
        </div>
        {error && <FieldError>{error}</FieldError>}
        {viewers.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-5 text-center text-[12px] text-muted">
            明示的な閲覧者はまだいません。
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {viewers.map((viewer) => (
              <li key={viewer.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-text">{viewer.name}</div>
                  <div className="truncate text-[11px] text-muted">
                    {viewer.email ?? "メール未設定"} ・ 追加 {formatMonthDay(viewer.grantedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(viewer)}
                  disabled={busy}
                  className="rounded px-2 py-1 text-[12px] text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PlanningDialog>
  );
}
