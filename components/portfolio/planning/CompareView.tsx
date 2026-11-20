"use client";

import { useState } from "react";
import {
  formatDays,
  formatDecisionDate,
  formatManYen,
  monthLabelFromStart,
} from "@/lib/planning/format";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";
import {
  isOpenProposalStatus,
  proposalReviewOutcomeLabel,
  proposalStatusLabel,
  proposalSubmissionBlock,
} from "@/lib/planning/approvals";
import {
  approvalFlowStages,
  budgetUsagePercent,
  comparisonOverview,
  previousReturnedProposal,
  primaryCapacityGap,
  proposalAttentionLabel,
  proposalPanelTitle,
  type ApprovalFlowStage,
} from "@/lib/planning/compare-summary";
import { fixedCalculation, scenarioCalculation } from "@/lib/planning/select";
import { PLANNING_MONTHS } from "@/lib/planning/types";
import type {
  PlanningProposal,
  PlanningSnapshotCell,
  PlanningState,
  PlanningView,
} from "@/lib/planning/types";
import DecisionHistory from "./DecisionHistory";
import PlanningTable from "./PlanningTable";
import ProposalDecisionForm, { type ProposalDecisionInput } from "./ProposalDecisionForm";
import ProposalHistory from "./ProposalHistory";
import ProposalReviewForm, { type ProposalReviewInput } from "./ProposalReviewForm";
import ProposalWithdrawForm, { type ProposalWithdrawInput } from "./ProposalWithdrawForm";
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

function ScenarioCard({
  result,
  budgetYen,
  recommended,
  emphasis,
  canAct,
  actionLabel,
  startMonth,
  onAction,
}: {
  result: PlanningScenarioResult;
  budgetYen: number;
  recommended: boolean;
  emphasis: "primary" | "secondary";
  canAct: boolean;
  actionLabel: string;
  startMonth: number;
  onAction: () => void;
}) {
  const gap = primaryCapacityGap(result, startMonth);
  const used = budgetUsagePercent(result.knownCostYen, budgetYen);
  const missing = missingText(result);
  const budgetTone = result.overBudget
    ? "font-semibold text-danger"
    : result.costMissing
      ? "text-warning"
      : "text-muted";
  return (
    <article
      className={`flex min-w-0 flex-col gap-4 rounded-lg border p-[18px] ${
        recommended
          ? "border-accent bg-surface-subtle"
          : "border-line bg-surface"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold text-text">{result.name}</h3>
        <StatusTag result={result} />
        {recommended && (
          <span className="ml-auto text-[12px] font-bold text-accent-text">
            申請者の推奨
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[28px] leading-none font-bold text-text tabular-nums">
          {formatManYen(result.knownCostYen)}
        </span>
        <span className="text-[13px] text-text">万円</span>
        <span className={`ml-1 text-[12px] ${budgetTone}`}>{budgetText(result)}</span>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full ${result.overBudget ? "bg-danger" : "bg-text"}`}
          style={{ width: `${used}%` }}
        />
      </div>

      <p
        className={`text-[13px] font-medium ${
          gap.tone === "danger"
            ? "text-danger"
            : gap.tone === "warning"
              ? "text-warning"
              : "text-success"
        }`}
      >
        {gap.text}
      </p>

      <div className="space-y-1 text-[12px] leading-6 text-muted">
        <p>
          <span className="font-medium text-secondary">実施: </span>
          {result.included.map((initiative) => initiative.name).join("、") || "なし"}
        </p>
        <p>
          <span className="font-medium text-secondary">見送り: </span>
          {result.skipped.map((initiative) => initiative.name).join("、") || "なし"}
        </p>
        {missing && <p className="text-[11px] text-warning">未設定: {missing}</p>}
      </div>

      <footer className="mt-auto pt-1">
        <button
          type="button"
          onClick={onAction}
          className={`${emphasis === "primary" ? buttonPrimary : buttonSecondary} w-full justify-center`}
          disabled={!canAct}
        >
          {actionLabel}
        </button>
      </footer>
    </article>
  );
}

function ApprovalFlow({ stages }: { stages: ApprovalFlowStage[] }) {
  const stateText = { done: "完了", current: "現在", upcoming: "未到達" } as const;
  const dot = {
    done: "bg-success",
    current: "bg-accent",
    upcoming: "bg-line",
  } as const;
  return (
    <ol
      aria-label="承認の流れ"
      className={`grid gap-2 text-[12px] ${
        stages.length === 3 ? "grid-cols-3" : "grid-cols-2"
      }`}
    >
      {stages.map((stage) => (
        <li key={stage.key} className="flex min-w-0 flex-col gap-1.5">
          <span aria-hidden className={`h-2 w-2 rounded-full ${dot[stage.state]}`} />
          <span
            className={
              stage.state === "current"
                ? "font-bold text-text"
                : "font-medium text-secondary"
            }
          >
            {stage.label}
            <span className="sr-only">（{stateText[stage.state]}）</span>
          </span>
          <span className="truncate text-[11px] text-muted">{stage.person}</span>
        </li>
      ))}
    </ol>
  );
}

function DecisionPanel({
  proposal,
  proposals,
  currentUserId,
  currentRevision,
  canReview,
  canDecide,
  canWithdraw,
  conflict,
  className = "",
  onReview,
  onDecide,
  onWithdraw,
}: {
  proposal: PlanningProposal;
  proposals: PlanningProposal[];
  currentUserId: number;
  currentRevision: number;
  canReview: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  conflict: boolean;
  className?: string;
  onReview: (input: ProposalReviewInput) => Promise<void>;
  onDecide: (input: ProposalDecisionInput) => Promise<void>;
  onWithdraw: (input: ProposalWithdrawInput) => Promise<void>;
}) {
  const previous = previousReturnedProposal(proposals, proposal);
  return (
    <aside
      aria-label="決裁"
      className={`flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-subtle p-[18px] xl:p-5 ${className}`}
    >
      <div className="flex items-baseline gap-2">
        <p className="text-[12px] font-bold text-accent-text">
          {proposalAttentionLabel(proposal, currentUserId)}
        </p>
        <span className="ml-auto text-[12px] text-muted">第{proposal.version}版</span>
      </div>
      <h2 className="text-[18px] leading-7 font-bold text-text">
        {proposalPanelTitle(proposal)}
      </h2>

      {proposal.restricted ? (
        <Notice tone="warn">
          この提案には閲覧権限のない元プロジェクトに紐づく案件が含まれるため、理由・推奨シナリオ・両案の内訳・合計を表示できません。申請者または編集者はこの版を取り下げ、新しい版を提出できます。
        </Notice>
      ) : (
        <>
          <ApprovalFlow stages={approvalFlowStages(proposal, currentUserId)} />

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-[12px] text-muted">
                申請者の理由 ・ {formatDecisionDate(proposal.submittedAt)}
              </h3>
              <p className="mt-1 text-[13px] leading-6 whitespace-pre-wrap text-secondary">
                {proposal.reason}
              </p>
            </div>
            {proposal.reviewOutcome && proposal.reviewOutcome !== "not_required" && (
              <div>
                <h3 className="text-[12px] text-muted">
                  レビューの回答
                  {proposal.reviewedAt ? ` ・ ${formatDecisionDate(proposal.reviewedAt)}` : ""}
                  {` ・ ${proposalReviewOutcomeLabel(proposal.reviewOutcome)}`}
                </h3>
                {proposal.reviewNote && (
                  <p className="mt-1 text-[13px] leading-6 whitespace-pre-wrap text-secondary">
                    {proposal.reviewNote}
                  </p>
                )}
              </div>
            )}
            {previous && (
              <a
                href={`#proposal-${previous.id}`}
                className="text-[12px] text-muted underline underline-offset-2 hover:text-text"
              >
                第{previous.version}版
                {previous.restricted
                  ? ""
                  : `（${previous.recommendedScenarioName}）`}
                は差し戻し済み
              </a>
            )}
          </div>
        </>
      )}

      {conflict && (
        <Notice tone="warn">
          申請者・最終承認者から独立した有効なレビュー担当が必要です。担当が設定と異なる提案は取り下げてください。
        </Notice>
      )}

      {canReview && (
        <ProposalReviewForm
          key={`panel-review-${proposal.id}`}
          reviewerName={proposal.reviewerName ?? ""}
          onReview={onReview}
        />
      )}
      {!canReview && proposal.status === "under_review" && !conflict && (
        <p className="text-[12px] text-muted">
          レビュー担当（{proposal.reviewerName ?? "未設定"}）の確認待ちです。割り当てられた担当者のみが確認または差し戻せます。
        </p>
      )}
      {canDecide && (
        <ProposalDecisionForm
          key={`panel-decision-${proposal.id}`}
          scenarioName={
            proposal.restricted ? undefined : proposal.recommendedScenarioName
          }
          onDecide={onDecide}
        />
      )}
      {!canDecide && proposal.status === "pending_decision" && !conflict && (
        <p className="text-[12px] text-muted">
          最終承認者（{proposal.finalApproverName}）の決裁待ちです。割り当てられた最終承認者のみが決定できます。
        </p>
      )}

      {canWithdraw && (
        <details>
          <summary className="cursor-pointer text-[12px] text-muted hover:text-text">
            この提案を取り下げる
          </summary>
          <div className="mt-3">
            <ProposalWithdrawForm
              key={`panel-withdraw-${proposal.id}-${proposal.status}`}
              currentStatus={proposal.status}
              onWithdraw={onWithdraw}
            />
          </div>
        </details>
      )}

      <p className="text-[12px] leading-6 text-muted">
        提出時点の両案を固定して記録します。採用後に計画を変更しても、この記録は変わりません。
        {!proposal.restricted && (
          <> 提出時の計画の版 {proposal.periodRevision} / 現在の版 {currentRevision}。</>
        )}
      </p>
    </aside>
  );
}

function supplyCell(cell: PlanningSnapshotCell | undefined) {
  if (!cell) {
    return <span className="text-muted">—</span>;
  }
  const demand = formatDays(cell.demandDays);
  const capacity =
    cell.capacityDays === null ? "未設定" : formatDays(cell.capacityDays);
  const unset = cell.capacityMissing || cell.demandMissing;
  const status = cell.shortageDays > 0
    ? `不足 ${formatDays(cell.shortageDays)}`
    : unset
      ? "未判定"
      : `残り ${formatDays(cell.gapDays ?? 0)}`;
  const tone = cell.shortageDays > 0
    ? "font-semibold text-danger"
    : unset
      ? "text-warning"
      : cell.gapDays === 0
        ? "text-muted"
        : "text-secondary";
  return (
    <span className={`tabular-nums ${tone}`}>
      {demand} / {capacity}（{status}）
    </span>
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
  const fixed = fixedCalculation(state);
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
  const canDecideOpenProposal =
    !conflictInProposal &&
    openProposal !== null &&
    !openProposal.restricted &&
    openProposal.status === "pending_decision" &&
    openProposal.finalApproverUserId === state.currentUserId;
  const canWithdrawOpenProposal =
    openProposal !== null &&
    (state.access.canEdit || openProposal.submitterUserId === state.currentUserId);
  const latestClosed =
    state.proposals.find(
      (proposal) =>
        proposal.status === "returned" ||
        proposal.status === "deferred" ||
        proposal.status === "withdrawn",
    ) ?? null;
  const proposalResult = proposalSlot === null ? null : scenarioCalculation(state, proposalSlot);
  const overview = comparisonOverview({
    budgetYen: period.budgetYen,
    fixed,
    initiatives: state.initiatives,
  });
  const recommendedSlot =
    openProposal && !openProposal.restricted ? openProposal.recommendedSlot : null;
  const showPanel = approval.enabled && openProposal !== null;

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

  const proposalAction = (slot: 0 | 1): string => {
    const name = slot === 0 ? scenarioA.name : scenarioB.name;
    if (!approval.enabled) return `${name}を採用…`;
    if (!openProposal) return `${name}で提案…`;
    if (canReviewOpenProposal) return `${name}の提案をレビュー`;
    if (
      openProposal.status === "pending_decision" &&
      !conflictInProposal &&
      openProposal.finalApproverUserId === state.currentUserId
    ) {
      return `${name}の提案を決裁`;
    }
    return `${name}の提案を確認`;
  };

  const proposalActionEnabled = (): boolean =>
    approval.enabled ? (openProposal !== null ? true : canSubmitProposal) : canEdit;

  const proposalActionHandler = (slot: 0 | 1): (() => void) => {
    if (!approval.enabled) return () => onAdopt(slot);
    if (openProposal) return () => setProposalDetailId(openProposal.id);
    return () => setProposalSlot(slot);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-text">投資シナリオ比較</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            案件の組み合わせを変えて、予算上限と月別の人員制約を比較します。A案とB案は独立して保存されます。
          </p>
        </div>
      </div>

      <div
        className={`grid gap-5 xl:items-start ${
          showPanel ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""
        }`}
      >
        <section
          aria-label="比較の概要"
          className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 xl:col-start-1 xl:row-start-1"
        >
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-[12px] text-muted">予算上限</dt>
              <dd className="mt-0.5 text-[22px] leading-tight font-bold text-text tabular-nums">
                {overview.budgetManYen}
                <span className="ml-1 text-[13px] font-normal text-muted">万円</span>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">固定案件</dt>
              <dd className="mt-0.5 text-[22px] leading-tight font-bold text-text tabular-nums">
                {overview.fixedManYen}
                <span className="ml-1 text-[13px] font-normal text-muted">万円</span>
                {overview.fixedCostMissing && (
                  <span className="ml-1.5 text-[11px] font-normal text-warning">
                    未設定あり
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">比較候補</dt>
              <dd className="mt-0.5 text-[22px] leading-tight font-bold text-text tabular-nums">
                {overview.candidateCount}
                <span className="ml-1 text-[13px] font-normal text-muted">件</span>
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className={buttonSecondary}
            onClick={onEditBudget}
            disabled={!canEdit}
          >
            予算上限を編集
          </button>
        </section>

        {showPanel && openProposal && (
          <DecisionPanel
            className="xl:col-start-2 xl:row-span-2 xl:row-start-1"
            proposal={openProposal}
            proposals={state.proposals}
            currentUserId={state.currentUserId}
            currentRevision={period.revision}
            canReview={canReviewOpenProposal}
            canDecide={canDecideOpenProposal}
            canWithdraw={canWithdrawOpenProposal}
            conflict={conflictInProposal}
            onReview={(input) => onReviewProposal(openProposal.id, input)}
            onDecide={(input) => onDecideProposal(openProposal.id, input)}
            onWithdraw={(input) => onWithdrawProposal(openProposal.id, input)}
          />
        )}

        <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-2">
          {approval.enabled && !openProposal && (
            <section
              aria-label="投資提案の承認"
              className="rounded-lg bg-surface-subtle px-4 py-3 text-[12px] text-secondary"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h3 className="text-[13px] font-bold text-text">投資提案の承認</h3>
                <Tag tone="blue">承認フロー有効</Tag>
                <span>
                  最終承認者: <b className="font-semibold text-text">{approval.finalApprover?.name ?? "未設定"}</b>
                </span>
                <span>
                  レビュー担当:{" "}
                  <b className="font-semibold text-text">
                    {approval.reviewer?.name ?? "なし"}
                  </b>
                </span>
              </div>
              <p className="mt-1.5">
                {latestClosed
                  ? `前回の提案（版${latestClosed.version}・${proposalStatusLabel(latestClosed.status)}）は終了しました。内容を見直して新しい提案を提出できます。`
                  : "採用する案を選び、理由を添えて投資提案として提出します。提出時点のA案・B案が固定され、最終承認者が決定します。直接採用はできません。"}
              </p>
              {reviewerUnavailable && canEdit && (
                <p className="mt-1 text-warning">
                  申請者・最終承認者から独立した有効なレビュー担当が必要です。担当が設定と異なる提案は取り下げてください。
                </p>
              )}
              {submissionBlock === "self_approval" && (
                <p className="mt-1.5 rounded border border-warning-line bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
                  あなたは最終承認者に設定されているため、自分の提案を提出できません。別のメンバーに提案を依頼するか、承認設定を変更してください。
                </p>
              )}
              {submissionBlock === "approver_missing" && (
                <p className="mt-1.5 rounded border border-warning-line bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
                  最終承認者が未設定または無効です。承認設定を確認してください。
                </p>
              )}
              {approverIneligible && (
                <p className="mt-1.5 rounded border border-warning-line bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
                  最終承認者がこの投資計画を完全に閲覧できません。承認設定で有効なメンバーを選び直してください。
                </p>
              )}
            </section>
          )}

          {latest && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2">
              <span className="min-w-0 text-[12px] text-accent-text">
                <b>採用記録　{latest.chosenScenarioName}</b>
                <span className="mx-2 text-accent-line">|</span>
                {latest.restricted ? "閲覧権限のない案件を含むため理由は非表示です" : latest.reason}
              </span>
              <a href="#decision-history" className={buttonQuiet}>
                決定履歴（{state.decisions.length}）
              </a>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ScenarioCard
              result={scenarioA}
              budgetYen={period.budgetYen}
              recommended={recommendedSlot === 0}
              emphasis={showPanel ? "secondary" : "primary"}
              canAct={proposalActionEnabled()}
              actionLabel={proposalAction(0)}
              startMonth={period.startMonth}
              onAction={proposalActionHandler(0)}
            />
            <ScenarioCard
              result={scenarioB}
              budgetYen={period.budgetYen}
              recommended={recommendedSlot === 1}
              emphasis={showPanel ? "secondary" : "primary"}
              canAct={proposalActionEnabled()}
              actionLabel={proposalAction(1)}
              startMonth={period.startMonth}
              onAction={proposalActionHandler(1)}
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
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-bold text-text">
                月別の需要 ／ 配賦枠（人日）
              </h3>
              <span className="text-[11px] text-muted">不足は既知の値でも表示します。</span>
            </div>
            <PlanningTable
              label="月別・職種別の需給比較"
              caption="A案とB案の月別・職種別の需給比較"
              matrix
              className="mt-2 rounded-lg border border-line bg-surface"
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
                        <td className="px-3 py-2 text-[11px] text-muted">
                          {monthLabelFromStart(period.startMonth, monthIndex)}
                        </td>
                        {[cellA, cellB].map((cell, index) => (
                          <td key={index} className="px-3 py-2 text-[11px]">
                            {supplyCell(cell)}
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

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className={buttonQuiet} onClick={() => onNavigate("ledger")}>
              ← 案件台帳に戻る
            </button>
            <button type="button" className={buttonQuiet} onClick={() => onNavigate("capacity")}>
              職種別・月別の内訳を見る →
            </button>
          </div>
        </div>
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
