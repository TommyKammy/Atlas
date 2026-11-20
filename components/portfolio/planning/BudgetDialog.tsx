"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  labelClass,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import { planningErrorMessage } from "./errors";
import { parseManYenInput, yenToManYenInput } from "@/lib/planning/format";

export default function BudgetDialog({
  open,
  onClose,
  budgetYen,
  periodLabel,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  budgetYen: number;
  periodLabel: string;
  onSave: (budgetYen: number) => Promise<void>;
}) {
  const formId = useId();
  const [value, setValue] = useState("");
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
    setValue(yenToManYenInput(budgetYen));
    setBusy(false);
    setError("");
  }, [open, budgetYen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseManYenInput(value);
    if (!parsed.ok || parsed.value === null) {
      setError(parsed.ok ? "予算を入力してください" : parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(parsed.value);
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
      title="期間の予算上限を編集"
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy}>
            {busy ? "保存中…" : "変更を保存"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[12px] text-secondary">{periodLabel} の予算上限を万円で入力します。</p>
        <label className={labelClass}>
          予算上限（万円）
          <input
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={`${inputClass} mt-1`}
            autoFocus
            required
          />
        </label>
        <p className="text-[11px] text-muted">
          保存・計算は円の整数で行います。画面表示だけを万円にしています。
        </p>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
