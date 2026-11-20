"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  PlanningApprovalCandidate,
  PlanningApprovalSettings,
} from "@/lib/planning/types";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
  Notice,
} from "./ui";

export type ApprovalSettingsInput = {
  enabled: boolean;
  finalApproverUserId: number | null;
  reviewerUserId: number | null;
};

export default function ApprovalSettingsDialog({
  open,
  onClose,
  settings,
  candidates,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  settings: PlanningApprovalSettings;
  candidates: PlanningApprovalCandidate[];
  onSave: (input: ApprovalSettingsInput) => Promise<void>;
}) {
  const formId = useId();
  const enabledId = useId();
  const helpId = useId();
  const approverSelectable =
    settings.finalApprover !== null &&
    candidates.some((candidate) => candidate.id === settings.finalApprover?.id);
  const reviewerSelectable =
    settings.reviewer !== null &&
    candidates.some((candidate) => candidate.id === settings.reviewer?.id);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [approverId, setApproverId] = useState(
    approverSelectable && settings.finalApprover ? String(settings.finalApprover.id) : "",
  );
  const [reviewerId, setReviewerId] = useState(
    reviewerSelectable && settings.reviewer ? String(settings.reviewer.id) : "",
  );
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
    setEnabled(settings.enabled);
    setApproverId(
      approverSelectable && settings.finalApprover ? String(settings.finalApprover.id) : "",
    );
    setReviewerId(
      reviewerSelectable && settings.reviewer ? String(settings.reviewer.id) : "",
    );
    setBusy(false);
    setError("");
  }, [open, settings, approverSelectable, reviewerSelectable]);

  const locked = settings.openProposalCount > 0;
  const approverIneligible = settings.finalApprover !== null && !approverSelectable;
  const reviewerIneligible = settings.reviewer !== null && !reviewerSelectable;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || locked) return;
    if (enabled && approverId === "") {
      setError("最終承認者を選択してください");
      return;
    }
    if (enabled && reviewerId && approverId === reviewerId) {
      setError("レビュー担当と最終承認者は別の人を指定してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        enabled,
        finalApproverUserId: enabled && approverId !== "" ? Number(approverId) : null,
        reviewerUserId: enabled && reviewerId !== "" ? Number(reviewerId) : null,
      });
      onClose();
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
      title="投資提案の承認設定"
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            閉じる
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonPrimary}
            disabled={busy || locked}
          >
            {busy ? "保存中…" : settings.enabled ? "設定変更を申請" : "承認設定を保存"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[12px] leading-5 text-secondary">
          承認を有効にすると、比較画面でA案・B案を直接採用せず、選んだ案と理由を投資提案として提出します。提出時点の両案は固定され、最終承認者が決定します。レビュー担当を設定した提案は、その担当者の確認後に最終決裁へ進みます。
        </p>

        {settings.enabled && <Notice tone="info">設定変更は別の編集者が申請し、現行の最終承認者が承認すると反映されます。</Notice>}
        {locked && (
          <Notice tone="warn">
            未解決の投資提案が{settings.openProposalCount}件あるため、承認の有効・無効や担当者は変更できません。提案を承認または差し戻してから変更してください。
          </Notice>
        )}

        <div className="rounded-md border border-line bg-surface-subtle px-3 py-2.5">
          <label className="flex min-h-7 items-start gap-2 text-[13px] font-medium text-text">
            <input
              id={enabledId}
              type="checkbox"
              name="approvalsEnabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={busy || locked}
              aria-describedby={helpId}
              className="mt-0.5 h-4 w-4 rounded border-line-strong"
            />
            <span>承認フローを有効にする</span>
          </label>
          <p id={helpId} className="mt-1 pl-6 text-[11px] text-muted">
            無効の場合は、これまでどおり比較画面から直接採用できます。
          </p>
        </div>

        {enabled && (
          <div className="space-y-3">
            <label className={labelClass}>
              最終承認者
              <span className="ml-1 text-danger" aria-hidden>
                *
              </span>
              <select
                value={approverId}
                onChange={(event) => {
                  setApproverId(event.target.value);
                  if (event.target.value === reviewerId) setReviewerId("");
                }}
                name="finalApproverUserId"
                className={`${inputClass} mt-1`}
                disabled={busy || locked}
                required
              >
                <option value="">最終承認者を選択…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.email ? `（${candidate.email}）` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClass}>
              既定のレビュー担当（任意）
              <select
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
                name="reviewerUserId"
                className={`${inputClass} mt-1`}
                disabled={busy || locked}
              >
                <option value="">レビューなし</option>
                {candidates.filter(candidate => String(candidate.id) !== approverId).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.email ? `（${candidate.email}）` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <Notice tone="info">
          候補には、現在この投資計画とすべての元プロジェクトを閲覧できる有効なメンバーだけを表示します。選択しても閲覧権限は自動付与されません。申請者自身は最終承認者になれません。
        </Notice>

        {settings.enabled && settings.finalApprover === null && !locked && (
          <Notice tone="warn">
            現在の最終承認者が無効または閲覧権限なしになっています。保存前に有効な最終承認者を選び直してください。
          </Notice>
        )}

        {settings.enabled && !locked && (approverIneligible || reviewerIneligible) && (
          <Notice tone="warn">
            現在の{approverIneligible ? "最終承認者" : "レビュー担当"}
            は、この投資計画の完全な閲覧権限を持たないか無効になっています。保存前に候補から選び直してください。
          </Notice>
        )}

        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
