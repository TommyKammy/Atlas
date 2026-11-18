"use client";

import { useState } from "react";
import { formatDays, monthLabelFromStart } from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import { fixedCalculation, scenarioCalculation } from "@/lib/planning/select";
import type { PlanningMonth, PlanningRole, PlanningState, PlanningView } from "@/lib/planning/types";
import { PLANNING_MONTHS } from "@/lib/planning/types";
import PlanningTable, { planningTableStyles } from "./PlanningTable";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  EmptyPanel,
  Notice,
  StatusTag,
} from "./ui";


type Preview = -1 | 0 | 1;

function missingSummary(result: PlanningScenarioResult): string {
  const items: string[] = [];
  if (result.missingCostCount > 0) items.push(`費用${result.missingCostCount}件`);
  if (result.missingDemandCount > 0) items.push(`需要${result.missingDemandCount}件`);
  if (result.missingCapacityCount > 0) items.push(`配賦枠${result.missingCapacityCount}件`);
  return items.length > 0 ? items.join("・") : "なし";
}

export default function CapacityView({
  state,
  onEditCapacity,
  onEditRoles,
  onNavigate,
  onOpenBreakdown,
}: {
  state: PlanningState;
  onEditCapacity: () => void;
  onEditRoles: () => void;
  onNavigate: (view: PlanningView) => void;
  onOpenBreakdown: (result: PlanningScenarioResult, role: PlanningRole, monthIndex: PlanningMonth) => void;
}) {
  const [preview, setPreview] = useState<Preview>(0);
  const period = state.selectedPeriod;
  if (!period) return null;

  const fixed = fixedCalculation(state);
  const scenarioA = scenarioCalculation(state, 0);
  const scenarioB = scenarioCalculation(state, 1);
  const result = preview === -1 ? fixed : preview === 0 ? scenarioA : scenarioB;
  const canEdit = state.access.canEditData;
  const segments: { value: Preview; label: string; result: PlanningScenarioResult | null }[] = [
    { value: -1, label: "固定案件", result: fixed },
    { value: 0, label: "A案", result: scenarioA },
    { value: 1, label: "B案", result: scenarioB },
  ];

  if (state.restricted) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-[16px] font-semibold text-text">職種別の余力</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            このポートフォリオに配賦された人日と、選択した案の需要を月別に確認します。
          </p>
        </div>
        <Notice tone="warn">
          {state.restrictedReason}
          閲覧できない案件が含まれるため、部分的な需給合計は表示しません。
        </Notice>
      </div>
    );
  }

  if (!result) {
    return (
      <Notice tone="error">需給を計算できませんでした。再読み込みしてください。</Notice>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-text">職種別の余力</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            このポートフォリオに配賦された人日と、選択した案の需要を月別に確認します。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={onEditRoles} disabled={!canEdit}>
            職種を管理
          </button>
          <button type="button" className={buttonPrimary} onClick={onEditCapacity} disabled={!canEdit}>
            配賦枠を編集
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-text">月別の需給</h3>
        <div className="inline-flex rounded-md border border-line-strong bg-surface p-0.5" role="group" aria-label="表示する案">
          {segments.map((segment) => (
            <button
              key={segment.value}
              type="button"
              onClick={() => setPreview(segment.value)}
              aria-pressed={preview === segment.value}
              className={`rounded px-3 py-1.5 text-[12px] font-medium ${
                preview === segment.value
                  ? "bg-accent text-on-accent"
                  : "text-secondary hover:bg-hover"
              }`}
            >
              {segment.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle px-3 py-2">
        <span className="text-[12px] font-semibold text-text">{result.name}</span>
        <StatusTag result={result} />
        {result.shortages.length > 0 && (
          <span className="text-[11px] text-orange-800">
            {result.shortages
              .map(
                (shortage) =>
                  `${monthLabelFromStart(period.startMonth, shortage.monthIndex)} ${shortage.roleName} 不足${formatDays(shortage.shortageDays)}人日`,
              )
              .join("、")}
          </span>
        )}
        {result.hasMissing && (
          <span className="text-[11px] text-warning">未設定: {missingSummary(result)}</span>
        )}
      </div>

      {state.roles.length === 0 ? (
        <EmptyPanel
          title="職種がまだ登録されていません"
          actions={
            canEdit ? (
              <button type="button" className={buttonPrimary} onClick={onEditRoles}>
                職種を登録
              </button>
            ) : undefined
          }
        >
          職種を登録すると、職種別・月別の配賦枠と案件需要を入力できます。
        </EmptyPanel>
      ) : (
        <>
          <PlanningTable
            label="月別の職種別需給"
            caption={`${period.label} ${result.name}の月別職種別需給`}
            matrix
            className="rounded-lg border border-line"
          >
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">
                  職種 / 案件の需要 / 配賦枠
                </th>
                {PLANNING_MONTHS.map((monthIndex) => (
                  <th
                    key={monthIndex}
                    scope="col"
                    className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary"
                  >
                    {monthLabelFromStart(period.startMonth, monthIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.roles.map((role) => (
                <tr key={role.id} className="border-b border-line-subtle last:border-b-0">
                  <th scope="row" className="bg-surface px-3 py-2.5 text-left text-[12px] font-medium text-text">
                    {role.name}
                  </th>
                  {PLANNING_MONTHS.map((monthIndex) => {
                    const cell = result.cells.find(
                      (entry) => entry.roleId === role.id && entry.monthIndex === monthIndex,
                    );
                    if (!cell) return <td key={monthIndex} className="px-3 py-2.5" />;
                    const hot = cell.shortageDays > 0;
                    const meterWidth =
                      cell.capacityDays === null
                        ? 0
                        : cell.capacityDays === 0
                          ? cell.demandDays > 0
                            ? 100
                            : 0
                          : Math.min(100, (cell.demandDays / cell.capacityDays) * 100);
                    const label =
                      cell.shortageDays > 0
                        ? `不足 ${formatDays(cell.shortageDays)} 人日`
                        : cell.capacityMissing
                          ? "配賦枠未設定"
                          : cell.demandMissing
                            ? `需要未設定（既知の残り ${formatDays(cell.gapDays ?? 0)} 人日）`
                            : `残り ${formatDays(cell.gapDays ?? 0)} 人日`;
                    return (
                      <td key={monthIndex} className="px-2 py-2">
                        <button
                          type="button"
                          className={planningTableStyles.cellButton}
                          onClick={() => onOpenBreakdown(result, role, monthIndex)}
                          aria-label={`${role.name} ${monthLabelFromStart(period.startMonth, monthIndex)}の内訳。需要 ${formatDays(cell.demandDays)} 人日、配賦枠 ${
                            cell.capacityDays === null ? "未設定" : `${formatDays(cell.capacityDays)} 人日`
                          }、${label}`}
                        >
                          <span className="block text-[12px]">
                            <b className="tabular-nums">
                              {formatDays(cell.demandDays)} /{" "}
                              {cell.capacityDays === null ? "未設定" : formatDays(cell.capacityDays)}
                            </b>
                            <span className="ml-1 text-[10px] font-normal text-muted">人日</span>
                          </span>
                          <span className={`${planningTableStyles.meter} ${hot ? planningTableStyles.meterHot : ""}`}>
                            <span style={{ width: `${meterWidth}%` }} />
                          </span>
                          <span className={`block text-[10px] ${hot ? "font-semibold text-orange-700" : "text-muted"}`}>
                            {label}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-surface-subtle">
                <th scope="row" className="px-3 py-2 text-left text-[11px] font-semibold text-secondary">
                  合計
                </th>
                {PLANNING_MONTHS.map((monthIndex) => {
                  const cells = result.cells.filter((cell) => cell.monthIndex === monthIndex);
                  const demand = cells.reduce((sum, cell) => sum + cell.demandDays, 0);
                  const shortages = cells.reduce((sum, cell) => sum + cell.shortageDays, 0);
                  return (
                    <td key={monthIndex} className="px-3 py-2 text-[11px] text-secondary tabular-nums">
                      需要 {formatDays(demand)} 人日
                      {shortages > 0 && (
                        <span className="ml-1 font-semibold text-orange-700">不足 {formatDays(shortages)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </PlanningTable>
          <p className="text-[11px] text-muted">
            各セルは「案件の需要 / 配賦枠」。セルを選ぶと案件別の内訳を確認できます。0は明示的な0、空欄は未設定です。
          </p>
        </>
      )}

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-3">
        <button type="button" className={buttonQuiet} onClick={() => onNavigate("ledger")}>
          ← 案件台帳に戻る
        </button>
        <button type="button" className={buttonQuiet} onClick={() => onNavigate("compare")}>
          投資シナリオを比較 →
        </button>
      </div>
    </div>
  );
}
