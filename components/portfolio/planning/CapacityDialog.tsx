"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  FieldError,
  inputClass,
  Notice,
} from "./ui";
import PlanningDialog from "./PlanningDialog";
import PlanningTable from "./PlanningTable";
import { planningErrorMessage } from "./errors";
import { formatDays, monthLabelFromStart, parseDaysInput } from "@/lib/planning/format";
import type { PlanningCapacity, PlanningMonth, PlanningRole } from "@/lib/planning/types";
import { PLANNING_MONTHS } from "@/lib/planning/types";

function key(roleId: number, monthIndex: PlanningMonth) {
  return `${roleId}:${monthIndex}`;
}

export default function CapacityDialog({
  open,
  onClose,
  roles,
  capacities,
  periodLabel,
  startMonth,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  roles: PlanningRole[];
  capacities: PlanningCapacity[];
  periodLabel: string;
  startMonth: number;
  onSave: (values: { roleId: number; monthIndex: PlanningMonth; days: number | null }[]) => Promise<void>;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
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
    const next: Record<string, string> = {};
    for (const role of roles) {
      for (const monthIndex of PLANNING_MONTHS) {
        const capacity = capacities.find(
          (entry) => entry.roleId === role.id && entry.monthIndex === monthIndex,
        );
        next[key(role.id, monthIndex)] =
          capacity === undefined ? "" : formatDays(capacity.days);
      }
    }
    setValues(next);
    setBusy(false);
    setError("");
  }, [open, roles, capacities]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const output: { roleId: number; monthIndex: PlanningMonth; days: number | null }[] = [];
    for (const role of roles) {
      for (const monthIndex of PLANNING_MONTHS) {
        const parsed = parseDaysInput(values[key(role.id, monthIndex)] ?? "");
        if (!parsed.ok) {
          setError(`${role.name} ${monthLabelFromStart(startMonth, monthIndex)}: ${parsed.error}`);
          return;
        }
        output.push({ roleId: role.id, monthIndex, days: parsed.value });
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSave(output);
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
      title="月別の配賦枠を編集"
      wide
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" form={formId} className={buttonPrimary} disabled={busy || roles.length === 0}>
            {busy ? "保存中…" : "配賦枠を保存"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-[12px] text-neutral-600">
          {periodLabel} にこのポートフォリオへ配賦する月間人日を入力します。通常業務や他ポートフォリオ分は差し引いた値を入力してください。
        </p>
        <p className="text-[11px] text-neutral-500">
          空欄は未設定、0は「配賦なし」として保存します。0.1人日刻みで入力できます。
        </p>
        {roles.length === 0 ? (
          <Notice tone="warn">職種がまだ登録されていません。先に「職種を管理」から登録してください。</Notice>
        ) : (
          <PlanningTable
            label="月別の配賦枠入力"
            caption="月別の配賦枠入力"
            className="rounded-lg border border-neutral-200"
          >
            <thead className="bg-neutral-50">
              <tr>
                <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-neutral-600">
                  職種 / 人日
                </th>
                {PLANNING_MONTHS.map((monthIndex) => (
                  <th
                    key={monthIndex}
                    scope="col"
                    className="border-b border-neutral-200 px-2 py-2 text-left text-[11px] font-semibold text-neutral-600"
                  >
                    {monthLabelFromStart(startMonth, monthIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-b border-neutral-100 last:border-b-0">
                  <th scope="row" className="bg-white px-3 py-2 text-left text-[12px] font-medium text-neutral-800">
                    {role.name}
                  </th>
                  {PLANNING_MONTHS.map((monthIndex) => (
                    <td key={monthIndex} className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        step="0.1"
                        value={values[key(role.id, monthIndex)] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [key(role.id, monthIndex)]: event.target.value,
                          }))
                        }
                        aria-label={`${role.name} ${monthLabelFromStart(startMonth, monthIndex)}の配賦枠（人日）`}
                        className={`${inputClass} h-8 w-24`}
                        placeholder="未設定"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </PlanningTable>
        )}
        {error && <FieldError>{error}</FieldError>}
      </form>
    </PlanningDialog>
  );
}
