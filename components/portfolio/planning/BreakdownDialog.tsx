"use client";

import { formatDays, monthLabelFromStart } from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import type { PlanningMonth, PlanningRole } from "@/lib/planning/types";
import PlanningDialog from "./PlanningDialog";
import PlanningTable from "./PlanningTable";
import { buttonSecondary, Tag } from "./ui";

export default function BreakdownDialog({
  open,
  onClose,
  result,
  role,
  monthIndex,
  startMonth,
}: {
  open: boolean;
  onClose: () => void;
  result: PlanningScenarioResult | null;
  role: PlanningRole | null;
  monthIndex: PlanningMonth | null;
  startMonth: number;
}) {
  if (!result || !role || monthIndex === null) {
    return null;
  }
  const monthLabel = monthLabelFromStart(startMonth, monthIndex);
  const cell = result.cells.find(
    (entry) => entry.roleId === role.id && entry.monthIndex === monthIndex,
  );
  if (!cell) return null;
  const rows = result.included.map((initiative) => {
    const demand = initiative.demands.find(
      (entry) => entry.roleId === role.id && entry.monthIndex === monthIndex,
    );
    return { initiative, days: demand?.days ?? null };
  });
  const incomplete = cell.demandMissing || cell.capacityMissing;

  return (
    <PlanningDialog
      open={open}
      onClose={onClose}
      title={`${monthLabel} · ${role.name}の内訳`}
      footer={
        <button type="button" className={buttonSecondary} onClick={onClose}>
          閉じる
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-text">{result.name}</div>
            <div className="text-[11px] text-muted">単位: 人日</div>
          </div>
          {cell.shortageDays > 0 ? (
            <Tag tone="bad">不足 {formatDays(cell.shortageDays)} 人日</Tag>
          ) : incomplete ? (
            <Tag tone="warn">未判定</Tag>
          ) : (
            <Tag tone="good">配賦枠内</Tag>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-6 text-center text-[12px] text-muted">
            この案に含まれる案件はありません。
          </p>
        ) : (
          <PlanningTable
            label={`${monthLabel} ${role.name}の案件別需要`}
            caption={`${monthLabel} ${role.name}の案件別需要`}
            className="rounded-lg border border-line"
          >
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">
                  需要の内訳
                </th>
                <th scope="col" className="border-b border-line px-3 py-2 text-right text-[11px] font-semibold text-secondary">
                  人日
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ initiative, days }) => (
                <tr key={initiative.id} className="border-b border-line-subtle last:border-b-0">
                  <th scope="row" className="bg-surface px-3 py-2 text-left text-[12px] font-medium text-text">
                    {initiative.name}{" "}
                    <span className="ml-1 font-normal text-muted">
                      {initiative.kind === "fixed" ? "固定" : "候補"}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-right text-[12px] tabular-nums">
                    {days === null ? "未設定" : formatDays(days)}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-subtle">
                <th scope="row" className="px-3 py-2 text-left text-[12px] font-semibold text-text">
                  需要合計（既知）
                </th>
                <td className="px-3 py-2 text-right text-[12px] font-semibold tabular-nums">
                  {formatDays(cell.demandDays)}
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 text-left text-[12px] font-semibold text-text">
                  配賦枠
                </th>
                <td className="px-3 py-2 text-right text-[12px] tabular-nums">
                  {cell.capacityDays === null ? "未設定" : formatDays(cell.capacityDays)}
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 text-left text-[12px] font-semibold text-text">
                  {cell.shortageDays > 0 ? "不足" : "既知の残り"}
                </th>
                <td className={`px-3 py-2 text-right text-[12px] font-semibold tabular-nums ${cell.shortageDays > 0 ? "text-warning" : ""}`}>
                  {cell.gapDays === null
                    ? "配賦枠未設定"
                    : cell.shortageDays > 0
                      ? `${formatDays(cell.shortageDays)} 人日不足`
                      : `${formatDays(cell.gapDays)} 人日`}
                </td>
              </tr>
            </tbody>
          </PlanningTable>
        )}
        {incomplete && (
          <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-[12px] text-warning">
            {cell.demandMissing && "需要が未設定の案件があります。"}
            {cell.capacityMissing && "配賦枠が未設定です。"}
            既知の不足は上に表示していますが、未設定項目が解消するまで「制約内」の判定はできません。
          </p>
        )}
      </div>
    </PlanningDialog>
  );
}
