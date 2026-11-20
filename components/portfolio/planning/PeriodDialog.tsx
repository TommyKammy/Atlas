"use client";

import { useId, useState } from "react";
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
import { parseManYenInput } from "@/lib/planning/format";
import type { PlanningQuarter, PlanningRole } from "@/lib/planning/types";
import { PLANNING_QUARTERS } from "@/lib/planning/types";

type CreateInput = {
  year: number;
  quarter: PlanningQuarter;
  budgetYen: number;
  roles: string[];
};

export default function PeriodDialog({
  open,
  onClose,
  onCreate,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateInput) => Promise<void>;
  roles: PlanningRole[];
}) {
  const formId = useId();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [quarter, setQuarter] = useState<PlanningQuarter>(
    (Math.floor(now.getMonth() / 3) + 1) as PlanningQuarter,
  );
  const [budget, setBudget] = useState("");
  const [roleNames, setRoleNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsedYear = Number(year);
    const parsedBudget = parseManYenInput(budget);
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setError("年は2000〜2100の整数で入力してください");
      return;
    }
    if (!parsedBudget.ok || parsedBudget.value === null) {
      setError(parsedBudget.ok ? "予算を入力してください" : parsedBudget.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate({
        year: parsedYear,
        quarter,
        budgetYen: parsedBudget.value,
        roles: roleNames
          .split(/[,、\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
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
      title="計画期間と予算を設定"
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy}>
            {busy ? "作成中…" : "この四半期を作成"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[12px] text-secondary">
          対象四半期と、このポートフォリオに配賦する期間予算を設定します。費用と予算は円の整数で保存し、画面では万円で表示します。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            年
            <input
              type="number"
              min={2000}
              max={2100}
              step={1}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className={`${inputClass} mt-1`}
              required
            />
          </label>
          <label className={labelClass}>
            四半期
            <select
              value={quarter}
              onChange={(event) => setQuarter(Number(event.target.value) as PlanningQuarter)}
              className={`${inputClass} mt-1`}
            >
              {PLANNING_QUARTERS.map((value) => (
                <option key={value} value={value}>
                  第{value}四半期（{(value - 1) * 3 + 1}月–{(value - 1) * 3 + 3}月）
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={labelClass}>
          期間の予算上限（万円）
          <input
            type="number"
            min={0}
            step="0.01"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            className={`${inputClass} mt-1`}
            placeholder="例: 1000"
            autoFocus
            required
          />
        </label>
        <div>
          <label className={labelClass}>
            職種（カンマ区切り・任意）
            <input
              value={roleNames}
              onChange={(event) => setRoleNames(event.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="例: DB担当, 開発担当, QA担当"
            />
          </label>
          <p className="mt-1 text-[11px] text-muted">
            {roles.length > 0
              ? `職種はポートフォリオ全体で共有されています（登録済み ${roles.length}件）。追加したい職種だけ入力してください。`
              : "ここで職種を登録すると、月別の配賦枠と案件別需要を入力できます。後から職種別の余力画面でも編集できます。"}
          </p>
        </div>
        <Notice tone="info">
          既存プロジェクトの開始日・タスク・担当者は変更しません。投資計画はこの四半期だけの見積もりとして保存されます。
        </Notice>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
