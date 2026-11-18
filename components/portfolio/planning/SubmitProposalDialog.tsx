"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  formatDays,
  formatManYen,
  monthLabelFromStart,
  periodLabel,
} from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import type {
  PlanningApprovalCandidate,
  PlanningApprovalSettings,
  PlanningPeriodSummary,
} from "@/lib/planning/types";
import type { ProposalSubmissionBlock } from "@/lib/planning/approvals";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
  Notice,
  Tag,
} from "./ui";

function issueSummary(result: PlanningScenarioResult, budgetYen: number, startMonth: number): string[] {
  const issues: string[] = [];
  if (result.overBudget) {
    issues.push(`予算を${formatManYen(result.knownCostYen - budgetYen)}万円超過`);
  }
  for (const shortage of result.shortages) {
    issues.push(
      `${monthLabelFromStart(startMonth, shortage.monthIndex)}の${shortage.roleName}が${formatDays(shortage.shortageDays)}人日不足`,
    );
  }
  if (result.hasMissing) {
    issues.push("未設定の項目があります");
  }
  return issues;
}

function blockMessage(block: ProposalSubmissionBlock | null): string | null {
  if (block === "approvals_disabled") {
    return "承認フローが有効になっていません。ポートフォリオの編集者が承認設定を有効にしてください。";
  }
  if (block === "approver_missing") {
    return "最終承認者が設定されていません。承認設定を確認してください。";
  }
  if (block === "self_approval") {
    return "申請者自身は最終承認者になれません。別のメンバーに提案を依頼するか、承認設定を変更してください。";
  }
  if (block === "open_proposal") {
    return "この四半期には未解決の投資提案があります。承認または差し戻し後に再提出してください。";
  }
  return null;
}

export type ProposalSubmitInput = {
  chosenSlot: 0 | 1;
  reason: string;
  reviewerUserId: number | null;
  requestId: string;
};

export default function SubmitProposalDialog({
  open,
  onClose,
  result,
  period,
  settings,
  candidates,
  block,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  result: PlanningScenarioResult | null;
  period: PlanningPeriodSummary;
  settings: PlanningApprovalSettings;
  candidates: PlanningApprovalCandidate[];
  block: ProposalSubmissionBlock | null;
  onSubmit: (input: ProposalSubmitInput) => Promise<void>;
}) {
  const formId = useId();
  const defaultReviewerEligible =
    settings.reviewer !== null &&
    candidates.some((candidate) => candidate.id === settings.reviewer?.id);
  const [reason, setReason] = useState("");
  const [reviewerId, setReviewerId] = useState(
    defaultReviewerEligible && settings.reviewer ? String(settings.reviewer.id) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setReason("");
    setReviewerId(
      defaultReviewerEligible && settings.reviewer ? String(settings.reviewer.id) : "",
    );
    setBusy(false);
    setError("");
    requestId.current = crypto.randomUUID();
  }, [open, settings, defaultReviewerEligible]);

  if (!result) return null;
  const issues = issueSummary(result, period.budgetYen, period.startMonth);
  const blockText = blockMessage(block);
  const canSubmit = block === null && (settings.reviewer === null || defaultReviewerEligible);
  const reviewerIneligible = settings.reviewer !== null && !defaultReviewerEligible;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    if (reason.trim() === "") {
      setError("提案理由を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        chosenSlot: result.slot,
        reason: reason.trim(),
        reviewerUserId: reviewerId === "" ? null : Number(reviewerId),
        requestId: requestId.current,
      });
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
      title={`${result.name}で投資提案`}
      wide
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonPrimary}
            disabled={busy || !canSubmit}
          >
            {busy ? "提出中…" : "理由とともに提案を提出"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-[12px] text-text">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{periodLabel(period.year, period.quarter)}</span>
            <Tag tone={result.status === "within" ? "good" : result.status === "unknown" ? "warn" : "bad"}>
              {result.status === "within" ? "制約内" : result.status === "unknown" ? "未判定" : "要調整"}
            </Tag>
          </div>
          <div className="mt-1">
            推奨シナリオ: <b>{result.name}</b> ／ 投資額 {formatManYen(result.knownCostYen)} 万円
            {result.costMissing ? "（未設定の費用あり）" : ""} ／ 予算 {formatManYen(period.budgetYen)} 万円
          </div>
          <div className="mt-1 text-[11px] text-secondary">
            最終承認者: {settings.finalApprover?.name ?? "未設定"}
            {settings.reviewer ? ` ／ 既定のレビュー担当: ${settings.reviewer.name}` : ""}
          </div>
        </div>

        {issues.length > 0 ? (
          <Notice tone={result.hasShortage ? "warn" : "info"}>{issues.join("。")}。</Notice>
        ) : (
          <Notice tone="success">既知の範囲では予算・職種別配賦枠内です。</Notice>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <section>
            <h3 className="text-[13px] font-semibold text-text">今期に実施</h3>
            <p className="mt-1 text-[12px] text-secondary">
              {result.included.map((initiative) => initiative.name).join("、") || "なし"}
            </p>
          </section>
          <section>
            <h3 className="text-[13px] font-semibold text-text">今期は見送り</h3>
            {result.skipped.length === 0 ? (
              <p className="mt-1 text-[12px] text-secondary">なし</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[12px] text-secondary">
                {result.skipped.map((initiative) => (
                  <li key={initiative.id}>
                    <span className="font-medium">{initiative.name}</span>
                    <span className="block text-[11px] text-muted">見送る効果: {initiative.expectedEffect}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <label className={labelClass}>
          {settings.reviewer ? "設定済みのレビュー担当" : "レビュー担当（任意）"}
          <select
            value={reviewerId}
            onChange={(event) => setReviewerId(event.target.value)}
            name="reviewerUserId"
            className={`${inputClass} mt-1`}
            disabled={busy || !canSubmit || settings.reviewer !== null}
          >
            <option value="">レビューなし</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.email ? `（${candidate.email}）` : ""}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-muted">
            設定した既定のレビュー担当を変更できます。レビュー担当を設定すると、その担当者の確認後に最終決裁へ進みます。未設定の場合は直接、最終決裁待ちになります。
          </span>
        </label>

        <label className={labelClass}>
          提案理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            name="reason"
            className="mt-1 min-h-28 w-full rounded-md border border-line-strong bg-white px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            maxLength={1000}
            placeholder="選んだ案の理由、見送る効果、不足への対応も記録できます"
            autoFocus
            required
            disabled={busy || !canSubmit}
          />
        </label>

        <p className="text-[11px] leading-5 text-muted">
          提出時点のA案・B案（案件名・期待効果・費用・月別需給・見送り・入力前提）と推奨シナリオ、理由、申請者、最終承認者、レビュー担当、日時を固定して保存します。提出後に現在の台帳を編集しても、この提案の内容は変わりません。
        </p>

        {blockText && <Notice tone="error">{blockText}</Notice>}
        {reviewerIneligible && (
          <Notice tone="warn">
            既定のレビュー担当が、現在この投資計画の完全な閲覧権限を持たないか無効になっています。承認設定の変更が必要です。
          </Notice>
        )}
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
