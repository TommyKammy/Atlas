"use client";

import Link from "next/link";
import { formatManYen } from "@/lib/planning/format";
import type { PlanningInitiative, PlanningState, PlanningView } from "@/lib/planning/types";
import PlanningTable from "./PlanningTable";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  EmptyPanel,
  Notice,
  Stat,
  Tag,
} from "./ui";


export default function LedgerView({
  state,
  onNew,
  onEdit,
  onEditBudget,
  onOpenCarryovers,
  onNavigate,
}: {
  state: PlanningState;
  onNew: (focusLink: boolean) => void;
  onEdit: (initiative: PlanningInitiative) => void;
  onEditBudget: () => void;
  onOpenCarryovers: () => void;
  onNavigate: (view: PlanningView) => void;
}) {
  const period = state.selectedPeriod;
  if (!period) return null;
  const fixed = state.initiatives.filter((initiative) => initiative.kind === "fixed");
  const candidates = state.initiatives.filter((initiative) => initiative.kind === "candidate");
  const fixedKnown = fixed.reduce((sum, initiative) => sum + (initiative.costYen ?? 0), 0);
  const candidateKnown = candidates.reduce((sum, initiative) => sum + (initiative.costYen ?? 0), 0);
  const fixedMissing = fixed.filter((initiative) => initiative.costYen === null).length;
  const candidateMissing = candidates.filter((initiative) => initiative.costYen === null).length;
  const canEdit = state.access.canEditData;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-neutral-900">案件台帳</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            進行中の案件と、新たに投資を検討する候補を管理します。金額は対象期間分です。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onEditBudget} className={buttonSecondary} disabled={!canEdit}>
            予算上限を編集
          </button>
          <button type="button" onClick={() => onNew(false)} className={buttonPrimary} disabled={!canEdit}>
            ＋ 案件を登録
          </button>
        </div>
      </div>

      {state.restricted && (
        <Notice tone="warn">
          {state.restrictedReason}
          個別に表示できる案件だけを表示しています。合計値は部分集計になるため表示していません。
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat
          label="期間の予算上限"
          value={state.restricted ? "—" : formatManYen(period.budgetYen)}
          unit={state.restricted ? undefined : "万円"}
          detail={state.restricted ? "非表示" : period.label}
        />
        <Stat
          label="固定案件の費用"
          value={state.restricted ? "—" : formatManYen(fixedKnown)}
          unit={state.restricted ? undefined : "万円"}
          detail={
            state.restricted
              ? "非表示"
              : fixedMissing > 0
                ? `費用未設定 ${fixedMissing}件`
                : `${fixed.length}件`
          }
        />
        <Stat
          label="候補の概算合計"
          value={state.restricted ? "—" : formatManYen(candidateKnown)}
          unit={state.restricted ? undefined : "万円"}
          detail={
            state.restricted
              ? "非表示"
              : candidateMissing > 0
                ? `費用未設定 ${candidateMissing}件`
                : `${candidates.length}件`
          }
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-neutral-900">
          案件一覧{" "}
          <span className="font-normal text-muted">
            · {state.restricted ? "表示可能 " : ""}
            {state.initiatives.length}件
          </span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {state.carryovers.length > 0 && (
            <button
              type="button"
              className={buttonQuiet}
              onClick={onOpenCarryovers}
              disabled={!canEdit}
            >
              既存の案件を追加（{state.carryovers.length}）
            </button>
          )}
          {!state.restricted && (
            <button type="button" className={buttonQuiet} onClick={() => onNew(true)} disabled={!canEdit}>
              既存プロジェクトを紐付ける
            </button>
          )}
        </div>
      </div>

      {state.initiatives.length === 0 ? (
        <EmptyPanel
          title={state.restricted ? "表示できる案件がありません" : "案件がまだありません"}
          actions={
            canEdit ? (
              <>
                <button type="button" className={buttonPrimary} onClick={() => onNew(false)}>
                  案件を登録
                </button>
                <button type="button" className={buttonSecondary} onClick={() => onNew(true)}>
                  既存プロジェクトを紐付ける
                </button>
                {state.carryovers.length > 0 && (
                  <button type="button" className={buttonSecondary} onClick={onOpenCarryovers}>
                    既存の案件を追加
                  </button>
                )}
              </>
            ) : undefined
          }
        >
          進行中・必須の案件は「全案に固定」、裁量案件は「比較候補」として登録します。最初に固定案件の費用と人日を入れると、候補を追加する前の残余が分かります。
        </EmptyPanel>
      ) : (
        <PlanningTable
          label="案件一覧"
          caption={`${period.label}の案件一覧`}
          stacked
          className="rounded-lg border border-neutral-200"
        >
          <thead className="bg-surface-subtle">
            <tr>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">案件名</th>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">扱い</th>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">期待効果</th>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">起案責任者</th>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-right text-[11px] font-semibold text-secondary">概算費用</th>
              <th scope="col" className="border-b border-neutral-200 px-3 py-2 text-left text-[11px] font-semibold text-secondary">元プロジェクト</th>
            </tr>
          </thead>
          <tbody>
            {state.initiatives.map((initiative) => (
              <tr key={initiative.id} className="border-b border-neutral-100 last:border-b-0">
                <th scope="row" data-label="案件名" className="bg-surface px-3 py-2.5 text-left align-top">
                  <button
                    type="button"
                    onClick={() => onEdit(initiative)}
                    disabled={!canEdit}
                    className="text-left text-[12px] font-semibold text-[#24529c] hover:underline disabled:cursor-not-allowed disabled:text-neutral-800 disabled:no-underline"
                  >
                    {initiative.name}
                  </button>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {initiative.linkedProjectId ? "既存プロジェクトと連携" : "新規提案"}
                  </span>
                </th>
                <td data-label="扱い" className="px-3 py-2.5 align-top">
                  {initiative.kind === "fixed" ? <Tag>全案に固定</Tag> : <Tag tone="blue">比較候補</Tag>}
                </td>
                <td data-label="期待効果" className="px-3 py-2.5 align-top text-[12px] text-neutral-700">
                  {initiative.expectedEffect}
                </td>
                <td data-label="起案責任者" className="px-3 py-2.5 align-top text-[12px] text-neutral-700">
                  {initiative.ownerName}
                </td>
                <td data-label="概算費用" className="px-3 py-2.5 text-right align-top text-[12px] tabular-nums">
                  {initiative.costYen === null ? (
                    <span className="text-warning">未設定</span>
                  ) : (
                    `${formatManYen(initiative.costYen)} 万円`
                  )}
                </td>
                <td data-label="元プロジェクト" className="px-3 py-2.5 align-top text-[12px]">
                  {initiative.linkedProjectId && initiative.linkedProjectName ? (
                    <Link
                      href={`/projects/${initiative.linkedProjectId}?view=list`}
                      className="text-[#24529c] hover:underline"
                    >
                      {initiative.linkedProjectName}
                    </Link>
                  ) : (
                    <span className="text-muted">なし</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </PlanningTable>
      )}

      {!state.restricted && (
        <div className="flex flex-wrap justify-end gap-3 border-t border-neutral-200 pt-3">
          <button type="button" className={buttonQuiet} onClick={() => onNavigate("capacity")}>
            職種別の余力を確認 →
          </button>
          <button type="button" className={buttonQuiet} onClick={() => onNavigate("compare")}>
            投資シナリオを比較 →
          </button>
        </div>
      )}
    </div>
  );
}
