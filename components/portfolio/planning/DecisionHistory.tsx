import {
  formatDays,
  formatDecisionDate,
  formatManYen,
  monthLabelFromStart,
  periodLabel,
  quarterStartMonth,
} from "@/lib/planning/format";
import type {
  PlanningDecision,
  PlanningScenarioSnapshot,
  PlanningSnapshotCell,
} from "@/lib/planning/types";
import PlanningTable from "./PlanningTable";
import { EmptyPanel, Notice, Tag } from "./ui";

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

function ScenarioSnapshotView({
  scenario,
  chosen,
  startMonth,
}: {
  scenario: PlanningScenarioSnapshot;
  chosen: boolean;
  startMonth: number;
}) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-white" open={chosen}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-neutral-900">
        <span>{scenario.name}</span>
        <span className="font-normal text-neutral-600">{formatManYen(scenario.knownCostYen)} 万円</span>
        {statusTag(scenario.status)}
        {chosen && <Tag tone="blue">採用</Tag>}
      </summary>
      <div className="space-y-3 border-t border-neutral-200 px-3 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
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
          <p className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-900">
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
            <h4 className="text-[12px] font-semibold text-neutral-800">今期に実施</h4>
            <p className="mt-1 text-[11px] text-neutral-600">
              {scenario.included.map((initiative) => initiative.name).join("、") || "なし"}
            </p>
          </section>
          <section>
            <h4 className="text-[12px] font-semibold text-neutral-800">今期は見送り</h4>
            {scenario.skipped.length === 0 ? (
              <p className="mt-1 text-[11px] text-neutral-600">なし</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[11px] text-neutral-600">
                {scenario.skipped.map((initiative) => (
                  <li key={initiative.id}>
                    <span className="font-medium text-neutral-800">{initiative.name}</span>
                    <span className="block">見送る効果: {initiative.expectedEffect}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <PlanningTable
          label={`${scenario.name}の採用時点の月別需給`}
          caption={`${scenario.name}の採用時点の月別需給`}
          matrix
          className="rounded-md border border-neutral-200"
        >
          <thead className="bg-neutral-50">
            <tr>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-neutral-600">
                職種 / 需要 / 配賦枠（人日）
              </th>
              {[1, 2, 3].map((monthIndex) => (
                <th
                  key={monthIndex}
                  scope="col"
                  className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-neutral-600"
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
              <tr key={group.roleId} className="border-b border-neutral-100 last:border-b-0">
                <th scope="row" className="bg-white px-3 py-2 text-left text-[12px] font-medium text-neutral-800">
                  {group.roleName}
                </th>
                {group.cells.map((cell) => (
                  <td
                    key={cell.monthIndex}
                    className={`px-3 py-2 text-[11px] tabular-nums ${
                      cell.shortageDays > 0 ? "font-semibold text-orange-700" : "text-neutral-600"
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

export default function DecisionHistory({ decisions }: { decisions: PlanningDecision[] }) {
  return (
    <section id="decision-history" className="scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">決定履歴</h2>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            採用時点の両案・理由・実行者・日時を固定して保存しています。現在の台帳を変更しても履歴は変わりません。
          </p>
        </div>
        <span className="text-[11px] text-neutral-500">{decisions.length}件</span>
      </div>
      {decisions.length === 0 ? (
        <div className="mt-3">
          <EmptyPanel title="まだ決定はありません">
            比較画面でA案またはB案を採用すると、両案の前提と結果、理由、実行者、日時がここに記録されます。
          </EmptyPanel>
        </div>
      ) : (
        <ol className="mt-3 space-y-4">
          {decisions.map((decision) => (
            <li key={decision.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      {decision.chosenScenarioName}を採用
                    </h3>
                    {decision.restricted && <Tag tone="warn">閲覧制限</Tag>}
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {formatDecisionDate(decision.decidedAt)} ・ {decision.actorName} ・ 版 {decision.periodRevision} ・
                    予算 {formatManYen(decision.budgetYen)} 万円
                  </p>
                </div>
              </div>
              {decision.restricted ? (
                <div className="mt-3">
                  <Notice tone="warn">
                    この決定には閲覧権限のない元プロジェクトに紐づく案件が含まれるため、理由・両案の内訳・合計を表示できません。全案件の元プロジェクト閲覧権限が必要です。
                  </Notice>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-800">
                    <span className="font-semibold">採用理由</span>
                    <p className="mt-1 whitespace-pre-wrap">{decision.reason}</p>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    対象期間: {periodLabel(decision.snapshot.period.year, decision.snapshot.period.quarter)} ／
                    予算 {formatManYen(decision.snapshot.period.budgetYen)} 万円
                  </p>
                  <div className="space-y-3">
                    {decision.snapshot.scenarios.map((scenario) => (
                      <ScenarioSnapshotView
                        key={scenario.slot}
                        scenario={scenario}
                        chosen={scenario.slot === decision.chosenSlot}
                        startMonth={quarterStartMonth(decision.snapshot.period.quarter)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
