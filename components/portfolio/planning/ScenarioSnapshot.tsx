import {
  formatDays,
  formatManYen,
  monthLabelFromStart,
} from "@/lib/planning/format";
import type {
  PlanningScenarioSnapshot,
  PlanningSnapshotCell,
} from "@/lib/planning/types";
import PlanningTable from "./PlanningTable";
import { Tag } from "./ui";

function statusTag(status: PlanningScenarioSnapshot["status"]) {
  if (status === "within") return <Tag tone="good">制約内</Tag>;
  if (status === "unknown") return <Tag tone="warn">未判定</Tag>;
  return <Tag tone="bad">要調整</Tag>;
}

function cellLabel(cell: PlanningSnapshotCell): string {
  const demand = `${formatDays(cell.demandDays)} / ${cell.capacityDays === null ? "未設定" : formatDays(cell.capacityDays)}`;
  if (cell.capacityMissing) return `${demand}（配賦枠未設定）`;
  if (cell.shortageDays > 0) return `${demand}（不足 ${formatDays(cell.shortageDays)}）`;
  if (cell.demandMissing) return `${demand}（需要未設定）`;
  return `${demand}（残り ${formatDays(cell.gapDays ?? 0)}）`;
}

/**
 * One frozen scenario from a submission or an adopted decision. Both variants
 * are rendered from the stored snapshot, never from the editable live plan.
 */
export default function ScenarioSnapshotView({
  scenario,
  highlighted,
  startMonth,
  highlightLabel = "採用",
  snapshotLabel = "採用時点",
}: {
  scenario: PlanningScenarioSnapshot;
  highlighted: boolean;
  startMonth: number;
  highlightLabel?: string;
  snapshotLabel?: string;
}) {
  return (
    <details className="rounded-lg border border-line bg-surface" open={highlighted}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-text">
        <span>{scenario.name}</span>
        <span className="font-normal text-secondary">{formatManYen(scenario.knownCostYen)} 万円</span>
        {statusTag(scenario.status)}
        {highlighted && <Tag tone="blue">{highlightLabel}</Tag>}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
          <span>
            投資額 {formatManYen(scenario.knownCostYen)} 万円
            {scenario.costMissing ? "（未設定の費用あり）" : ""}
          </span>
          <span>
            {scenario.overBudget ? "予算超過" : "予算残"} {formatManYen(Math.abs(scenario.budgetRemainingYen))} 万円
          </span>
          {scenario.hasMissing && (
            <span>
              未設定: 費用{scenario.missingCostCount}件・需要{scenario.missingDemandCount}件・配賦枠
              {scenario.missingCapacityCount}件
            </span>
          )}
        </div>
        {scenario.shortages.length > 0 && (
          <p className="rounded-md border border-warning-line bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
            {scenario.shortages
              .map(
                (shortage) =>
                  `${monthLabelFromStart(startMonth, shortage.monthIndex)}の${shortage.roleName}が${formatDays(shortage.shortageDays)}人日不足`,
              )
              .join("。")}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <section>
            <h4 className="text-[12px] font-semibold text-text">今期に実施</h4>
            <p className="mt-1 text-[11px] text-secondary">
              {scenario.included.map((initiative) => initiative.name).join("、") || "なし"}
            </p>
          </section>
          <section>
            <h4 className="text-[12px] font-semibold text-text">今期は見送り</h4>
            {scenario.skipped.length === 0 ? (
              <p className="mt-1 text-[11px] text-secondary">なし</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[11px] text-secondary">
                {scenario.skipped.map((initiative) => (
                  <li key={initiative.id}>
                    <span className="font-medium text-text">{initiative.name}</span>
                    <span className="block">見送る効果: {initiative.expectedEffect}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <PlanningTable
          label={`${scenario.name}の${snapshotLabel}の月別需給`}
          caption={`${scenario.name}の${snapshotLabel}の月別需給`}
          matrix
          className="rounded-md border border-line"
        >
          <thead className="bg-surface-subtle">
            <tr>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">
                職種 / 需要 / 配賦枠（人日）
              </th>
              {[1, 2, 3].map((monthIndex) => (
                <th
                  key={monthIndex}
                  scope="col"
                  className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary"
                >
                  {monthLabelFromStart(startMonth, monthIndex as 1 | 2 | 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenario.cells.reduce<{ roleId: number; roleName: string; cells: PlanningSnapshotCell[] }[]>(
              (groups, cell) => {
                const group = groups.find((entry) => entry.roleId === cell.roleId);
                if (group) group.cells.push(cell);
                else groups.push({ roleId: cell.roleId, roleName: cell.roleName, cells: [cell] });
                return groups;
              },
              [],
            ).map((group) => (
              <tr key={group.roleId} className="border-b border-line-subtle last:border-b-0">
                <th scope="row" className="bg-surface px-3 py-2 text-left text-[12px] font-medium text-text">
                  {group.roleName}
                </th>
                {group.cells.map((cell) => (
                  <td
                    key={cell.monthIndex}
                    className={`px-3 py-2 text-[11px] tabular-nums ${
                      cell.shortageDays > 0 ? "font-semibold text-warning" : "text-secondary"
                    }`}
                  >
                    {cellLabel(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </PlanningTable>
      </div>
    </details>
  );
}
