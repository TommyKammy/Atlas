"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  Notice,
  Tag,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import { formatDays, formatManYen, monthLabelFromStart, periodLabel } from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import type { PlanningPeriodSummary } from "@/lib/planning/types";

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

export default function AdoptDialog({
  open,
  onClose,
  result,
  period,
  canAdopt,
  onAdopt,
}: {
  open: boolean;
  onClose: () => void;
  result: PlanningScenarioResult | null;
  period: PlanningPeriodSummary;
  canAdopt: boolean;
  onAdopt: (input: { chosenSlot: 0 | 1; reason: string; requestId: string }) => Promise<void>;
}) {
  const formId = useId();
  const [reason, setReason] = useState("");
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
    setBusy(false);
    setError("");
    requestId.current = crypto.randomUUID();
  }, [open]);

  if (!result) return null;
  const issues = issueSummary(result, period.budgetYen, period.startMonth);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (reason.trim() === "") {
      setError("採用理由を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAdopt({
        chosenSlot: result.slot,
        reason: reason.trim(),
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
      title={`${result.name}を採用`}
      wide
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy || !canAdopt}>
            {busy ? "記録中…" : "理由とともに採用"}
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
            投資額 {formatManYen(result.knownCostYen)} 万円
            {result.costMissing ? "（未設定の費用あり）" : ""} ／ 予算 {formatManYen(period.budgetYen)} 万円
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
        <label className="block text-[12px] font-medium text-secondary">
          採用理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 min-h-24 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-[13px] text-text outline-none focus:border-[#2c60b8]"
            maxLength={1000}
            placeholder="見送る効果や、不足への対応も記録できます"
            autoFocus
            required
          />
        </label>
        <p className="text-[11px] text-muted">
          採用時点の両案（費用・月別需給・案件名・期待効果・見送り・入力前提）と理由・実行者・日時を固定して保存します。現在の台帳を後から変更しても、この履歴は変わりません。
        </p>
        {!canAdopt && (
          <Notice tone="error">閲覧のみのため採用できません。所有者または管理者に依頼してください。</Notice>
        )}
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
