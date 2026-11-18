"use client";

import { useState } from "react";
import { formatDays, formatManYen, monthLabelFromStart } from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import {
  isOpenProposalStatus,
  proposalStatusLabel,
  proposalSubmissionBlock,
} from "@/lib/planning/approvals";
import { scenarioCalculation } from "@/lib/planning/select";
import { PLANNING_MONTHS } from "@/lib/planning/types";
import type {
  PlanningMonth,
  PlanningSnapshotCell,
  PlanningState,
  PlanningView,
} from "@/lib/planning/types";
import DecisionHistory from "./DecisionHistory";
import PlanningTable from "./PlanningTable";
import ProposalHistory from "./ProposalHistory";
import type { ProposalDecisionInput } from "./ProposalDecisionForm";
import type { ProposalReviewInput } from "./ProposalReviewForm";
import type { ProposalWithdrawInput } from "./ProposalWithdrawForm";
import SubmitProposalDialog, { type ProposalSubmitInput } from "./SubmitProposalDialog";
import { planningErrorMessage } from "./errors";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  Notice,
  StatusTag,
  Tag,
} from "./ui";


function budgetText(result: PlanningScenarioResult): string {
  if (result.overBudget) return `予算超過 ${formatManYen(Math.abs(result.budgetRemainingYen))} 万円`;
  if (result.costMissing) {
    return `既知の予算残 ${formatManYen(result.budgetRemainingYen)} 万円（未設定の費用あり）`;
  }
  return `予算残 ${formatManYen(result.budgetRemainingYen)} 万円`;
}

function missingText(result: PlanningScenarioResult): string {
  const items: string[] = [];
  if (result.missingCostCount > 0) items.push(`費用${result.missingCostCount}件`);
  if (result.missingDemandCount > 0) items.push(`需要${result.missingDemandCount}件`);
  if (result.missingCapacityCount > 0) items.push(`配賦枠${result.missingCapacityCount}件`);
  return items.join("・");
}

type CompareFocus = {
  roleId: number;
  roleName: string;
  monthIndex: PlanningMonth;
  reason: "shortage" | "tight";
};

const RATIO_EPSILON = 1e-9;

function focusKey(cell: { roleId: number; monthIndex: PlanningMonth }): string {
  return `${cell.roleId}:${cell.monthIndex}`;
}

function focusStatusText(cell: PlanningSnapshotCell): string {
  if (cell.shortageDays > 0) return `不足 ${formatDays(cell.shortageDays)} 人日`;
  if (cell.capacityDays === null) return "配賦枠未設定";
  if (cell.demandMissing) return "需要未設定";
  return `残り ${formatDays(cell.gapDays ?? 0)} 人日`;
}

/**
 * Pick one role/month to compare at the top of both cards. The largest known
 * shortage across either plan wins. When neither plan is short, use the
 * highest known demand/capacity ratio (the tightest cell). Cells without a
 * known positive capacity or without any known demand are skipped so 0 and
 * unset values cannot produce a misleading focus.
 */
function compareFocus(
  scenarioA: PlanningScenarioResult,
  scenarioB: PlanningScenarioResult,
): CompareFocus | null {
  if (scenarioA.cells.length === 0) return null;
  const bCells = new Map(
    scenarioB.cells.map((cell) => [focusKey(cell), cell] as const),
  );
  const pairs = scenarioA.cells.map((cellA) => ({
    cellA,
    cellB: bCells.get(focusKey(cellA)) ?? cellA,
  }));

  let worstShortage = 0;
  let shortageCell: PlanningSnapshotCell | null = null;
  for (const { cellA, cellB } of pairs) {
    const shortage = Math.max(cellA.shortageDays, cellB.shortageDays);
    if (shortage > worstShortage) {
      worstShortage = shortage;
      shortageCell = cellA.shortageDays >= cellB.shortageDays ? cellA : cellB;
    }
  }
  if (shortageCell) {
    return {
      roleId: shortageCell.roleId,
      roleName: shortageCell.roleName,
      monthIndex: shortageCell.monthIndex,
      reason: "shortage",
    };
  }

  let tightestCell: PlanningSnapshotCell | null = null;
  let tightestRatio = -1;
  for (const { cellA, cellB } of pairs) {
    for (const cell of [cellA, cellB]) {
      if (
        cell.capacityDays === null ||
        cell.capacityDays <= 0 ||
        cell.demandDays <= 0 ||
        cell.demandMissing
      ) {
        continue;
      }
      const ratio = cell.demandDays / cell.capacityDays;
      if (
        ratio > tightestRatio + RATIO_EPSILON ||
        (Math.abs(ratio - tightestRatio) <= RATIO_EPSILON &&
          (tightestCell === null || cell.demandDays > tightestCell.demandDays))
      ) {
        tightestCell = cell;
        tightestRatio = ratio;
      }
    }
  }
  if (!tightestCell) return null;
  return {
    roleId: tightestCell.roleId,
    roleName: tightestCell.roleName,
    monthIndex: tightestCell.monthIndex,
    reason: "tight",
  };
}

function ScenarioCard({
  result,
  focus,
  canAct,
  actionLabel,
  startMonth,
  onAction,
}: {
  result: PlanningScenarioResult;
  focus: CompareFocus | null;
  canAct: boolean;
  actionLabel: string;
  startMonth: number;
  onAction: () => void;
}) {
  const missing = missingText(result);
  const focusCell = focus
    ? (result.cells.find(
        (cell) => cell.roleId === focus.roleId && cell.monthIndex === focus.monthIndex,
      ) ?? null)
    : null;
  const focusRatio =
    focusCell && focusCell.capacityDays !== null && focusCell.capacityDays > 0
      ? Math.min(100, (focusCell.demandDays / focusCell.capacityDays) * 100)
      : 0;
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-semibold text-text">{result.name}</h3>
        <StatusTag result={result} />
      </header>
      {focus && (
        <div className="border-b border-line bg-surface-subtle px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[11px] font-semibold text-secondary">
              {focus.reason === "shortage"
                ? "共通の制約点（最大の不足）"
                : "共通の制約点（最も余力が少ない）"}
              : {monthLabelFromStart(startMonth, focus.monthIndex)} {focus.roleName}
            </span>
            <span className="text-[10px] text-muted">案件の需要 / 配賦枠</span>
          </div>
          {focusCell ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`text-[20px] font-semibold tabular-nums ${
                    focusCell.shortageDays > 0 ? "text-orange-800" : "text-text"
                  }`}
                >
                  {formatDays(focusCell.demandDays)} /{" "}
                  {focusCell.capacityDays === null ? "未設定" : formatDays(focusCell.capacityDays)}
                </span>
                <span className="text-[11px] text-muted">人日</span>
                <span
                  className={`ml-auto text-[11px] ${
                    focusCell.shortageDays > 0
                      ? "font-semibold text-orange-800"
                      : focusCell.capacityMissing || focusCell.demandMissing
                        ? "text-warning"
                        : "font-semibold text-text"
                  }`}
                >
                  {focusStatusText(focusCell)}
                </span>
              </div>
              {focusCell.capacityDays !== null && focusCell.capacityDays > 0 && (
                <div
                  className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-surface-strong"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full rounded-full ${
                      focusCell.shortageDays > 0 ? "bg-[#c2602f]" : "bg-[#7f9dcc]"
                    }`}
                    style={{ width: `${focusRatio}%` }}
                  />
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-[11px] text-muted">
              この職種・月の需給データがありません。
            </p>
          )}
        </div>
      )}
      <div className="grid flex-1 gap-3 p-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] text-muted">投資額</div>
          <div className="mt-0.5 text-[22px] font-semibold text-text tabular-nums">
            {formatManYen(result.knownCostYen)}{" "}
            <span className="text-[12px] font-normal text-muted">万円</span>
          </div>
          <div className={`mt-0.5 text-[11px] ${result.overBudget ? "font-semibold text-orange-700" : "text-muted"}`}>
            {budgetText(result)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted">実施案件 / 見送り</div>
          <div className="mt-0.5 text-[14px] font-semibold text-text tabular-nums">
            {result.included.length}
            <span className="ml-1 text-[12px] font-normal text-muted">件</span>
            <span className="mx-1.5 text-subtle">/</span>
            {result.skipped.length}
            <span className="ml-1 text-[12px] font-normal text-muted">件</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            月別の不足 {result.shortages.length}件
          </div>
        </div>
        <div className="sm:col-span-2">
          {result.shortages.length > 0 && (
            <p className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-medium text-orange-900">
              不足:{" "}
              {result.shortages
                .map(
                  (shortage) =>
                    `${monthLabelFromStart(startMonth, shortage.monthIndex)} ${shortage.roleName} ${formatDays(shortage.shortageDays)}人日`,
                )
                .join("、")}
            </p>
          )}
          {result.overBudget && (
            <p className="mt-1 rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-medium text-orange-900">
              予算を {formatManYen(-result.budgetRemainingYen)} 万円超過
              （投資額 {formatManYen(result.knownCostYen)} 万円）
            </p>
          )}
          {missing && (
            <p className="mt-1 rounded-md border border-amber-200 bg-warning-soft px-2.5 py-1.5 text-[11px] text-amber-900">
              未設定: {missing}。既知の不足は上に表示していますが、未設定が解消するまで「制約内」の判定はできません。
            </p>
          )}
        </div>
        <section className="sm:col-span-2">
          <h4 className="text-[11px] font-semibold text-secondary">今期に実施</h4>
          <p className="mt-0.5 text-[11px] text-secondary">
            {result.included.map((initiative) => initiative.name).join("、") || "なし"}
          </p>
        </section>
        <section className="sm:col-span-2">
          <h4 className="text-[11px] font-semibold text-secondary">今期は見送り（見送る効果）</h4>
          {result.skipped.length === 0 ? (
            <p className="mt-0.5 text-[11px] text-secondary">なし</p>
          ) : (
            <ul className="mt-0.5 space-y-1 text-[11px] text-secondary">
              {result.skipped.map((initiative) => (
                <li key={initiative.id}>
                  <span className="font-medium text-text">{initiative.name}</span>
                  <span className="block">見送る効果: {initiative.expectedEffect}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer className="border-t border-line px-4 py-3">
        <button type="button" onClick={onAction} className={buttonPrimary} disabled={!canAct}>
          {actionLabel}
        </button>
      </footer>
    </article>
  );
}

export default function CompareView({
  state,
  onToggle,
  onAdopt,
  onSubmitProposal,
  onReviewProposal,
  onDecideProposal,
  onWithdrawProposal,
  onEditBudget,
  onNavigate,
}: {
  state: PlanningState;
  onToggle: (slot: 0 | 1, initiativeId: number, checked: boolean) => Promise<void>;
  onAdopt: (slot: 0 | 1) => void;
  onSubmitProposal: (input: ProposalSubmitInput) => Promise<void>;
  onReviewProposal: (proposalId: number, input: ProposalReviewInput) => Promise<void>;
  onDecideProposal: (proposalId: number, input: ProposalDecisionInput) => Promise<void>;
  onWithdrawProposal: (proposalId: number, input: ProposalWithdrawInput) => Promise<void>;
  onEditBudget: () => void;
  onNavigate: (view: PlanningView) => void;
}) {
  const [busySlot, setBusySlot] = useState<0 | 1 | null>(null);
  const [toggleError, setToggleError] = useState("");
  const [proposalSlot, setProposalSlot] = useState<0 | 1 | null>(null);
  const [proposalDetailId, setProposalDetailId] = useState<number | null>(null);
  const period = state.selectedPeriod;
  if (!period) return null;
  const scenarioA = scenarioCalculation(state, 0);
  const scenarioB = scenarioCalculation(state, 1);
  const selectedA = new Set(
    state.scenarios?.find((scenario) => scenario.slot === 0)?.selectedInitiativeIds ?? [],
  );
  const selectedB = new Set(
    state.scenarios?.find((scenario) => scenario.slot === 1)?.selectedInitiativeIds ?? [],
  );
  const canEdit = state.access.canEditData;
  const latest = state.decisions[0];
  const approval = state.approval;
  const openProposal =
    state.proposals.find((proposal) => isOpenProposalStatus(proposal.status)) ?? null;
  const submissionBlock = approval.enabled
    ? proposalSubmissionBlock({
        approvalsEnabled: approval.enabled,
        finalApproverUserId: approval.finalApprover?.id ?? null,
        submitterUserId: state.currentUserId,
        openProposal: openProposal !== null,
      })
    : null;
  const approverIneligible =
    approval.finalApprover !== null &&
    state.approvalCandidates !== null &&
    !state.approvalCandidates.some(
      (candidate) => candidate.id === approval.finalApprover?.id,
    );
  const reviewerUnavailable = approval.reviewer !== null && (
    approval.reviewer.id === state.currentUserId || approval.reviewer.id === approval.finalApprover?.id ||
    (state.approvalCandidates !== null && !state.approvalCandidates.some(member => member.id === approval.reviewer?.id))
  );
  const canSubmitProposal = !reviewerUnavailable && canEdit && submissionBlock === null && !approverIneligible;
  const conflictInProposal = openProposal?.invalidReview === true;
  const canReviewOpenProposal = !conflictInProposal &&
    openProposal !== null &&
    openProposal.status === "under_review" &&
    state.access.canReview &&
    openProposal.reviewerUserId === state.currentUserId;
  const latestClosed =
    state.proposals.find(
      (proposal) =>
        proposal.status === "returned" ||
        proposal.status === "deferred" ||
        proposal.status === "withdrawn",
    ) ?? null;
  const proposalResult = proposalSlot === null ? null : scenarioCalculation(state, proposalSlot);

  const toggle = async (slot: 0 | 1, initiativeId: number, checked: boolean) => {
    if (busySlot !== null) return;
    setBusySlot(slot);
    setToggleError("");
    try {
      await onToggle(slot, initiativeId, checked);
    } catch (caught) {
      setToggleError(planningErrorMessage(caught));
    } finally {
      setBusySlot(null);
    }
  };

  if (state.restricted) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-[16px] font-semibold text-text">投資シナリオ比較</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            案件の組み合わせを変えて、予算上限と月別の人員制約を比較します。
          </p>
        </div>
        <Notice tone="warn">
          {state.restrictedReason}
          閲覧できない案件が含まれるため、合計・不足・見送る効果・採用操作は表示できません。
        </Notice>
        {(approval.enabled || state.proposals.length > 0) && (
          <ProposalHistory
            key={`proposal-history-${period.id}`}
            proposals={state.proposals}
            period={period}
            approvalEnabled={approval.enabled}
            selectedId={proposalDetailId}
            onSelect={setProposalDetailId}
            currentUserId={state.currentUserId}
            canReview={state.access.canReview}
            canEdit={state.access.canEdit}
            onReview={onReviewProposal}
            onDecide={onDecideProposal}
            onWithdraw={onWithdrawProposal}
          />
        )}
      </div>
    );
  }

  if (!scenarioA || !scenarioB) {
    return <Notice tone="error">比較案を読み込めませんでした。再読み込みしてください。</Notice>;
  }

  const focus = compareFocus(scenarioA, scenarioB);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-text">投資シナリオ比較</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            案件の組み合わせを変えて、予算上限 {formatManYen(period.budgetYen)} 万円と月別の人員制約を比較します。A案とB案は独立して保存されます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={onEditBudget} disabled={!canEdit}>
            予算上限を編集
          </button>
        </div>
      </div>

      {approval.enabled && (
        <section
          aria-label="投資提案の承認"
          className="rounded-md border border-accent-line bg-accent-soft px-3 py-2.5 text-[12px] text-accent-text"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="blue">承認フロー有効</Tag>
            <span>
              最終承認者: <b>{approval.finalApprover?.name ?? "未設定"}</b>
            </span>
            <span className="text-blue-300" aria-hidden>
              |
            </span>
            <span>
              レビュー担当:{" "}
              <b>{openProposal?.reviewerName ?? approval.reviewer?.name ?? "なし"}</b>
            </span>
          </div>
          {openProposal ? (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <span>
                {openProposal.restricted ? (
                  <>
                    この四半期の提案（版{openProposal.version}）は提出済みです。
                    閲覧権限のない元プロジェクトを含むため内容は非表示です。申請者または編集者は詳細から取り下げできます。
                  </>
                ) : (
                  <>
                    この四半期の提案（版{openProposal.version}）は
                    <b>{openProposal.recommendedScenarioName}</b>の推奨で提出済みです。
                  </>
                )}
                {openProposal.status === "under_review"
                  ? canReviewOpenProposal
                    ? "あなたがレビュー担当です。提出時点の内容を確認してください。"
                    : `レビュー担当（${openProposal.reviewerName ?? "未設定"}）の確認待ちです。`
                  : !conflictInProposal && openProposal.finalApproverUserId === state.currentUserId
                    ? "あなたが最終承認者です。最終決裁待ちです。"
                    : "最終承認者の決定を待っています。"}
              </span>
              <button type="button" className={buttonQuiet} onClick={() => setProposalDetailId(openProposal.id)}>
                {canReviewOpenProposal
                  ? "レビューする"
                  : openProposal.status === "pending_decision" &&
                      !conflictInProposal && openProposal.finalApproverUserId === state.currentUserId
                    ? "決裁する"
                    : "提案の詳細を開く"}
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-accent-text">
              {latestClosed
                ? `前回の提案（版${latestClosed.version}・${proposalStatusLabel(latestClosed.status)}）は終了しました。内容を見直して新しい提案を提出できます。`
                : "採用する案を選び、理由を添えて投資提案として提出します。提出時点のA案・B案が固定され、最終承認者が決定します。直接採用はできません。"}
            </p>
          )}
          {(conflictInProposal || (!openProposal && reviewerUnavailable && canEdit)) && (
            <p>申請者・最終承認者から独立した有効なレビュー担当が必要です。担当が設定と異なる提案は取り下げてください。</p>
          )}
          {submissionBlock === "self_approval" && !openProposal && (
            <p className="mt-1.5 rounded border border-amber-300 bg-warning-soft px-2.5 py-1.5 text-[11px] text-amber-900">
              あなたは最終承認者に設定されているため、自分の提案を提出できません。別のメンバーに提案を依頼するか、承認設定を変更してください。
            </p>
          )}
          {submissionBlock === "approver_missing" && (
            <p className="mt-1.5 rounded border border-amber-300 bg-warning-soft px-2.5 py-1.5 text-[11px] text-amber-900">
              最終承認者が未設定または無効です。承認設定を確認してください。
            </p>
          )}
          {approverIneligible && (
            <p className="mt-1.5 rounded border border-amber-300 bg-warning-soft px-2.5 py-1.5 text-[11px] text-amber-900">
              最終承認者がこの投資計画を完全に閲覧できません。承認設定で有効なメンバーを選び直してください。
            </p>
          )}
        </section>
      )}

      {latest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-line bg-accent-soft px-3 py-2">
          <span className="min-w-0 text-[12px] text-accent-text">
            <b>採用記録　{latest.chosenScenarioName}</b>
            <span className="mx-2 text-blue-300">|</span>
            {latest.restricted ? "閲覧権限のない案件を含むため理由は非表示です" : latest.reason}
          </span>
          <a href="#decision-history" className={buttonQuiet}>
            決定履歴（{state.decisions.length}）
          </a>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <ScenarioCard
          result={scenarioA}
          focus={focus}
          canAct={approval.enabled ? (openProposal !== null ? true : canSubmitProposal) : canEdit}
          actionLabel={
            approval.enabled
              ? openProposal
                ? canReviewOpenProposal
                  ? `${scenarioA.name}の提案をレビュー`
                  : openProposal.status === "pending_decision" &&
                      !conflictInProposal && openProposal.finalApproverUserId === state.currentUserId
                    ? `${scenarioA.name}の提案を決裁`
                    : `${scenarioA.name}の提案を確認`
                : `${scenarioA.name}で提案…`
              : `${scenarioA.name}を採用…`
          }
          startMonth={period.startMonth}
          onAction={
            approval.enabled
              ? openProposal
                ? () => setProposalDetailId(openProposal.id)
                : () => setProposalSlot(0)
              : () => onAdopt(0)
          }
        />
        <ScenarioCard
          result={scenarioB}
          focus={focus}
          canAct={approval.enabled ? (openProposal !== null ? true : canSubmitProposal) : canEdit}
          actionLabel={
            approval.enabled
              ? openProposal
                ? canReviewOpenProposal
                  ? `${scenarioB.name}の提案をレビュー`
                  : openProposal.status === "pending_decision" &&
                      !conflictInProposal && openProposal.finalApproverUserId === state.currentUserId
                    ? `${scenarioB.name}の提案を決裁`
                    : `${scenarioB.name}の提案を確認`
                : `${scenarioB.name}で提案…`
              : `${scenarioB.name}を採用…`
          }
          startMonth={period.startMonth}
          onAction={
            approval.enabled
              ? openProposal
                ? () => setProposalDetailId(openProposal.id)
                : () => setProposalSlot(1)
              : () => onAdopt(1)
          }
        />
      </div>

      {toggleError && <Notice tone="error">{toggleError}</Notice>}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-semibold text-text">案件の組み合わせ</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              チェックした比較候補を各案に含めます。固定案件は両案に必ず含まれます。変更はその案だけに保存されます。
            </p>
          </div>
          {busySlot !== null && <span className="text-[11px] text-muted" role="status">保存中…</span>}
        </div>
        <PlanningTable
          label="案件の組み合わせ"
          caption="案件の組み合わせ"
          stacked
          className="mt-2 rounded-lg border border-line"
        >
          <thead className="bg-surface-subtle">
            <tr>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">案件 / 期待効果</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-right text-[11px] font-semibold text-secondary">対象期間の費用</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">A案</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">B案</th>
            </tr>
          </thead>
          <tbody>
            {state.initiatives.map((initiative) => {
              return (
                <tr key={initiative.id} className="border-b border-line-subtle last:border-b-0">
                  <th scope="row" data-label="案件" className="bg-surface px-3 py-2.5 text-left align-top">
                    <span className="text-[12px] font-semibold text-text">{initiative.name}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">{initiative.expectedEffect}</span>
                  </th>
                  <td data-label="対象期間の費用" className="px-3 py-2.5 text-right align-top text-[12px] tabular-nums">
                    {initiative.costYen === null ? (
                      <span className="text-warning">未設定</span>
                    ) : (
                      `${formatManYen(initiative.costYen)} 万円`
                    )}
                  </td>
                  {([0, 1] as const).map((slot) => {
                    const checked = slot === 0 ? selectedA.has(initiative.id) : selectedB.has(initiative.id);
                    if (initiative.kind === "fixed") {
                      return (
                        <td key={slot} data-label={slot === 0 ? "A案" : "B案"} className="px-3 py-2.5 align-top">
                          <Tag>全案に固定</Tag>
                        </td>
                      );
                    }
                    return (
                      <td key={slot} data-label={slot === 0 ? "A案" : "B案"} className="px-3 py-2.5 align-top">
                        <label className="flex min-h-7 items-center gap-2 text-[11px] text-secondary">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit || busySlot !== null}
                            onChange={(event) => void toggle(slot, initiative.id, event.target.checked)}
                            aria-label={`${slot === 0 ? "A案" : "B案"}に${initiative.name}を含める`}
                            className="h-4 w-4 rounded border-line-strong"
                          />
                          <span>{checked ? "今期に実施" : "今期は見送り"}</span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </PlanningTable>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-text">月別・職種別の需給比較</h3>
          <span className="text-[11px] text-muted">案件の需要 / 配賦枠。不足は既知の値でも表示します。</span>
        </div>
        <PlanningTable
          label="月別・職種別の需給比較"
          caption="A案とB案の月別・職種別の需給比較"
          matrix
          className="mt-2 rounded-lg border border-line"
        >
          <thead className="bg-surface-subtle">
            <tr>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">職種</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">月</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">A案</th>
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold text-secondary">B案</th>
            </tr>
          </thead>
          <tbody>
            {state.roles.flatMap((role) =>
              PLANNING_MONTHS.map((monthIndex) => {
                const cellA = scenarioA.cells.find(
                  (cell) => cell.roleId === role.id && cell.monthIndex === monthIndex,
                );
                const cellB = scenarioB.cells.find(
                  (cell) => cell.roleId === role.id && cell.monthIndex === monthIndex,
                );
                return (
                  <tr key={`${role.id}:${monthIndex}`} className="border-b border-line-subtle last:border-b-0">
                    <th scope="row" className="bg-surface px-3 py-2 text-left text-[12px] font-medium text-text">
                      {role.name}
                    </th>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      {monthLabelFromStart(period.startMonth, monthIndex)}
                    </td>
                    {[cellA, cellB].map((cell, index) => (
                      <td key={index} className="px-3 py-2 text-[11px] tabular-nums">
                        {cell ? (
                          <span className={cell.shortageDays > 0 ? "font-semibold text-orange-700" : "text-secondary"}>
                            {formatDays(cell.demandDays)} / {cell.capacityDays === null ? "未設定" : formatDays(cell.capacityDays)}
                            {cell.shortageDays > 0
                              ? `（不足 ${formatDays(cell.shortageDays)}）`
                              : cell.capacityMissing || cell.demandMissing
                                ? "（未判定）"
                                : `（残り ${formatDays(cell.gapDays ?? 0)}）`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              }),
            )}
          </tbody>
        </PlanningTable>
      </section>

      {(approval.enabled || state.proposals.length > 0) && (
        <ProposalHistory
          key={`proposal-history-${period.id}`}
          proposals={state.proposals}
          period={period}
          approvalEnabled={approval.enabled}
          selectedId={proposalDetailId}
          onSelect={setProposalDetailId}
          currentUserId={state.currentUserId}
          canReview={state.access.canReview}
          canEdit={state.access.canEdit}
          onReview={onReviewProposal}
          onDecide={onDecideProposal}
          onWithdraw={onWithdrawProposal}
        />
      )}

      <DecisionHistory
        decisions={state.decisions}
        proposals={state.proposals}
        approvalEnabled={approval.enabled}
      />

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-3">
        <button type="button" className={buttonQuiet} onClick={() => onNavigate("ledger")}>
          ← 案件台帳に戻る
        </button>
        <button type="button" className={buttonQuiet} onClick={() => onNavigate("capacity")}>
          職種別・月別の内訳を見る →
        </button>
      </div>

      {proposalSlot !== null && (
        <SubmitProposalDialog
          open
          onClose={() => setProposalSlot(null)}
          result={proposalResult}
          period={period}
          settings={approval}
          candidates={(state.approvalCandidates ?? []).filter(candidate => candidate.id !== state.currentUserId && candidate.id !== approval.finalApprover?.id)}
          block={submissionBlock}
          onSubmit={async (input) => {
            await onSubmitProposal(input);
            setProposalSlot(null);
          }}
        />
      )}
    </div>
  );
}
