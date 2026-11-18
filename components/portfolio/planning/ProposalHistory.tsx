"use client";

import {
  formatDecisionDate,
  formatManYen,
  periodLabel,
  quarterStartMonth,
} from "@/lib/planning/format";
import {
  isOpenProposalStatus,
  proposalDecisionActionLabel,
  proposalDecisionStageLabel,
  proposalReviewOutcomeLabel,
  proposalReviewStageLabel,
  proposalStatusLabel,
} from "@/lib/planning/approvals";
import type {
  PlanningPeriodSummary,
  PlanningProposal,
  PlanningProposalStatus,
} from "@/lib/planning/types";
import PlanningDialog from "./PlanningDialog";
import ProposalDecisionForm, { type ProposalDecisionInput } from "./ProposalDecisionForm";
import ProposalReviewForm, { type ProposalReviewInput } from "./ProposalReviewForm";
import ProposalWithdrawForm, { type ProposalWithdrawInput } from "./ProposalWithdrawForm";
import ScenarioSnapshotView from "./ScenarioSnapshot";
import { buttonQuiet, buttonSecondary, EmptyPanel, Notice, Tag } from "./ui";

function statusTone(status: PlanningProposalStatus): "neutral" | "blue" | "good" | "warn" | "bad" {
  if (
    status === "submitted" ||
    status === "under_review" ||
    status === "pending_decision"
  ) {
    return "blue";
  }
  if (status === "approved") return "good";
  if (status === "deferred" || status === "returned" || status === "rejected") return "warn";
  return "neutral";
}

function proposalTitle(proposal: PlanningProposal): string {
  return `投資提案（版${proposal.version}）`;
}

function actionNeeded(proposal: PlanningProposal, currentUserId: number): string {
  if (isOpenProposalStatus(proposal.status) && proposal.invalidReview) {
    return "レビュー担当の割当が不正です。提案を取り下げ、設定に従って再提出してください。";
  }
  if (proposal.status === "under_review") {
    return proposal.reviewerUserId === currentUserId
      ? "あなたのレビューが必要です。"
      : `レビュー担当（${proposal.reviewerName ?? "未設定"}）の確認待ちです。`;
  }
  if (proposal.status === "pending_decision") {
    if (proposal.decisionAction === null && proposal.reviewOutcome === "not_required") {
      return proposal.finalApproverUserId === currentUserId
        ? "レビューは省略されています。あなたの最終決裁が必要です。"
        : `レビューは省略されています。${proposal.finalApproverName}の最終決裁待ちです。`;
    }
    return proposal.finalApproverUserId === currentUserId
      ? "あなたの最終決裁が必要です。"
      : `${proposal.finalApproverName}の最終決裁待ちです。`;
  }
  if (proposal.status === "returned") {
    return "差し戻し済みです。申請者または編集者が新しい版を提出できます。";
  }
  if (proposal.status === "deferred") {
    return "今期は見送りとして記録されました。次の版を提出できます。";
  }
  if (proposal.status === "withdrawn") {
    return "取り下げ済みです。現在の計画で新しい版を提出できます。";
  }
  if (proposal.status === "approved") {
    return "承認済みです。採用内容は決定履歴に固定されています。";
  }
  return "この版は終了しています。";
}

function ProposalStages({ proposal }: { proposal: PlanningProposal }) {
  const review = proposalReviewStageLabel(proposal.reviewerUserId, proposal.reviewOutcome);
  const decision = proposalDecisionStageLabel(proposal.status);
  return (
    <ol
      aria-label="提案の進行状況"
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-secondary"
    >
      <li className="rounded-full border border-line-strong bg-surface-subtle px-2 py-0.5 font-semibold">
        申請済み
      </li>
      <li aria-hidden>→</li>
      <li
        className={`rounded-full border px-2 py-0.5 font-semibold ${
          review === "レビュー省略"
            ? "border-line-strong bg-surface-subtle text-secondary"
            : review === "レビューで差し戻し"
              ? "border-amber-200 bg-warning-soft text-warning"
              : "border-blue-200 bg-blue-50 text-blue-800"
        }`}
      >
        {review}
      </li>
      <li aria-hidden>→</li>
      <li
        className={`rounded-full border px-2 py-0.5 font-semibold ${
          proposal.status === "approved"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : proposal.status === "pending_decision"
              ? "border-blue-200 bg-blue-50 text-blue-800"
              : "border-line-strong bg-surface-subtle text-secondary"
        }`}
      >
        {decision}
      </li>
    </ol>
  );
}

function ProposalDetail({
  proposal,
  currentRevision,
  currentUserId,
  canReview,
  canEdit,
  onReview,
  onDecide,
  onWithdraw,
}: {
  proposal: PlanningProposal;
  currentRevision: number;
  currentUserId: number;
  canReview: boolean;
  canEdit: boolean;
  onReview: (input: ProposalReviewInput) => Promise<void>;
  onDecide: (input: ProposalDecisionInput) => Promise<void>;
  onWithdraw: (input: ProposalWithdrawInput) => Promise<void>;
}) {
  const canReviewThis = !proposal.invalidReview &&
    canReview &&
    proposal.status === "under_review" &&
    proposal.reviewerUserId === currentUserId &&
    !proposal.restricted;
  const canDecideThis = !proposal.invalidReview &&
    !proposal.restricted &&
    proposal.status === "pending_decision" &&
    proposal.finalApproverUserId === currentUserId;
  const canWithdrawThis =
    isOpenProposalStatus(proposal.status) &&
    (canEdit || proposal.submitterUserId === currentUserId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={statusTone(proposal.status)}>{proposalStatusLabel(proposal.status)}</Tag>
        <span className="text-[12px] font-medium text-text">{proposalTitle(proposal)}</span>
        {proposal.restricted && <Tag tone="warn">閲覧制限</Tag>}
      </div>
      <ProposalStages proposal={proposal} />
      <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-[12px] font-medium text-text">
        {actionNeeded(proposal, currentUserId)}
      </p>

      <dl className="grid gap-x-4 gap-y-2 rounded-md border border-line bg-surface-subtle px-3 py-2.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-muted">対象期間</dt>
          <dd className="font-medium text-text">
            {proposal.restricted
              ? "閲覧制限のため非表示"
              : periodLabel(
                  proposal.snapshot.period.year,
                  proposal.snapshot.period.quarter,
                )}
          </dd>
        </div>
        <div>
          <dt className="text-muted">申請者 / 提出日時</dt>
          <dd className="font-medium text-text">
            {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">最終承認者</dt>
          <dd className="font-medium text-text">{proposal.finalApproverName}</dd>
        </div>
        <div>
          <dt className="text-muted">レビュー担当</dt>
          <dd className="font-medium text-text">{proposal.reviewerName ?? "レビューなし"}</dd>
        </div>
        <div>
          <dt className="text-muted">レビュー結果</dt>
          <dd className="font-medium text-text">
            {proposalReviewStageLabel(proposal.reviewerUserId, proposal.reviewOutcome)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">レビュー日時</dt>
          <dd className="font-medium text-text">
            {proposal.reviewedAt ? formatDecisionDate(proposal.reviewedAt) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">最終決裁</dt>
          <dd className="font-medium text-text">
            {proposalDecisionStageLabel(proposal.status)}
            {proposal.decisionAction ? `（${proposalDecisionActionLabel(proposal.decisionAction)}）` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted">決裁者 / 決裁日時</dt>
          <dd className="font-medium text-text">
            {proposal.decidedByName
              ? `${proposal.decidedByName} ・ ${proposal.decidedAt ? formatDecisionDate(proposal.decidedAt) : "—"}`
              : "—"}
          </dd>
        </div>
        {!proposal.restricted && (
          <>
            <div>
              <dt className="text-muted">提出時の計画の版 / 現在の版</dt>
              <dd className="font-medium text-text">
                {proposal.periodRevision} / {currentRevision}
              </dd>
            </div>
            <div>
              <dt className="text-muted">予算</dt>
              <dd className="font-medium text-text">
                {formatManYen(proposal.budgetYen)} 万円
              </dd>
            </div>
          </>
        )}
      </dl>

      {proposal.restricted ? (
        <Notice tone="warn">
          この提案には閲覧権限のない元プロジェクトに紐づく案件が含まれるため、理由・推奨シナリオ・両案の内訳・合計を表示できません。申請者または編集者はこの版を取り下げ、新しい版を提出できます。
        </Notice>
      ) : (
        <>
          <Notice tone="info">
            以下は提出時点（版{proposal.version}）の内容です。現在の計画を編集しても、この提案のスナップショットは変わりません。
          </Notice>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900">
            <div className="font-semibold">
              推奨シナリオ: {proposal.recommendedScenarioName}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-blue-800">
              申請者の理由 ・ {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap">{proposal.reason}</p>
          </div>

          {proposal.reviewOutcome === "not_required" ? (
            <Notice tone="info">レビューは省略されています（レビュー担当なし）。</Notice>
          ) : proposal.reviewOutcome ? (
            <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-text">
              <div className="text-[11px] font-semibold text-secondary">
                レビューの回答 ・ {proposal.reviewerName ?? "レビュー担当"} ・{" "}
                {proposal.reviewedAt ? formatDecisionDate(proposal.reviewedAt) : "—"} ・{" "}
                {proposalReviewOutcomeLabel(proposal.reviewOutcome)}
              </div>
              {proposal.reviewNote && (
                <p className="mt-1 whitespace-pre-wrap">{proposal.reviewNote}</p>
              )}
            </div>
          ) : null}

          {proposal.decisionAction && proposal.decidedAt && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-950">
              <div className="text-[11px] font-semibold text-emerald-900">
                最終決裁（{proposalDecisionActionLabel(proposal.decisionAction)}） ・{" "}
                {proposal.decidedByName ?? proposal.finalApproverName} ・{" "}
                {formatDecisionDate(proposal.decidedAt)}
              </div>
              {proposal.decisionNote && (
                <p className="mt-1 whitespace-pre-wrap">{proposal.decisionNote}</p>
              )}
              {proposal.decisionId !== null && (
                <a href="#decision-history" className="mt-1 inline-block underline">
                  決定履歴の採用記録を見る
                </a>
              )}
            </div>
          )}

          {proposal.status === "withdrawn" && proposal.withdrawReason && (
            <div className="rounded-md border border-amber-200 bg-warning-soft px-3 py-2 text-[12px] text-amber-950">
              <div className="text-[11px] font-semibold text-amber-900">
                取り下げ ・ {proposal.withdrawnByName ?? "申請者"} ・{" "}
                {proposal.withdrawnAt ? formatDecisionDate(proposal.withdrawnAt) : "—"}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{proposal.withdrawReason}</p>
            </div>
          )}

          <div className="space-y-3">
            {proposal.snapshot.scenarios.map((scenario) => (
              <ScenarioSnapshotView
                key={scenario.slot}
                scenario={scenario}
                highlighted={scenario.slot === proposal.recommendedSlot}
                startMonth={quarterStartMonth(proposal.snapshot.period.quarter)}
                highlightLabel="推奨"
                snapshotLabel="提出時点"
              />
            ))}
          </div>
        </>
      )}

      {canReviewThis && (
        <ProposalReviewForm
          key={`review-${proposal.id}`}
          reviewerName={proposal.reviewerName ?? ""}
          onReview={onReview}
        />
      )}
      {proposal.status === "under_review" && !canReviewThis && (
        <Notice tone="info">
          レビュー担当（{proposal.reviewerName ?? "未設定"}）の確認待ちです。割り当てられた担当者のみが確認または差し戻せます。
        </Notice>
      )}
      {canDecideThis && (
        <ProposalDecisionForm
          key={`decision-${proposal.id}`}
          onDecide={onDecide}
        />
      )}
      {proposal.status === "pending_decision" && !canDecideThis && (
        <Notice tone="info">
          最終承認者（{proposal.finalApproverName}）の決裁待ちです。割り当てられた最終承認者のみが決定できます。
        </Notice>
      )}
      {proposal.status === "returned" && (
        <Notice tone="warn">
          この提案は差し戻されました。共有されたコメントを確認し、同じ四半期に新しい版の提案を提出できます。
        </Notice>
      )}
      {proposal.status === "deferred" && (
        <Notice tone="warn">
          この提案は今期見送りとして記録されました。採用記録は作成されていません。次の版を提出できます。
        </Notice>
      )}
      {proposal.status === "withdrawn" && (
        <Notice tone="info">
          この版は取り下げられました。現在の計画で新しい版を提出できます。
        </Notice>
      )}
      {proposal.status === "approved" && (
        <Notice tone="success">
          承認され、提出時点のスナップショットが決定履歴に採用記録として固定されました。
        </Notice>
      )}

      {canWithdrawThis && (
        <ProposalWithdrawForm
          key={`withdraw-${proposal.id}-${proposal.status}`}
          currentStatus={proposal.status}
          onWithdraw={onWithdraw}
        />
      )}
    </div>
  );
}

export default function ProposalHistory({
  proposals,
  period,
  approvalEnabled,
  selectedId,
  onSelect,
  currentUserId,
  canReview,
  canEdit,
  onReview,
  onDecide,
  onWithdraw,
}: {
  proposals: PlanningProposal[];
  period: PlanningPeriodSummary;
  approvalEnabled: boolean;
  selectedId: number | null;
  onSelect: (proposalId: number | null) => void;
  currentUserId: number;
  canReview: boolean;
  canEdit: boolean;
  onReview: (proposalId: number, input: ProposalReviewInput) => Promise<void>;
  onDecide: (proposalId: number, input: ProposalDecisionInput) => Promise<void>;
  onWithdraw: (proposalId: number, input: ProposalWithdrawInput) => Promise<void>;
}) {
  const selected = proposals.find((proposal) => proposal.id === selectedId) ?? null;

  return (
    <section id="proposal-history" className="scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-text">投資提案</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            提出時点のA案・B案と推奨シナリオを固定して保存しています。現在の計画とは別の内容です。
          </p>
        </div>
        <span className="text-[11px] text-muted">{proposals.length}件</span>
      </div>

      {proposals.length === 0 ? (
        <div className="mt-3">
          <EmptyPanel title="まだ投資提案はありません">
            {approvalEnabled
              ? "比較画面でA案またはB案を選び、理由を添えて提案すると、提出時点の両案がここに記録されます。"
              : "承認フローが有効な場合に、比較画面から投資提案を提出できます。"}
          </EmptyPanel>
        </div>
      ) : (
        <ol className="mt-3 space-y-3">
          {proposals.map((proposal) => {
            return (
              <li
                key={proposal.id}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-text">
                        {proposalTitle(proposal)}
                      </h3>
                      <Tag tone={statusTone(proposal.status)}>
                        {proposalStatusLabel(proposal.status)}
                      </Tag>
                      {proposal.restricted && <Tag tone="warn">閲覧制限</Tag>}
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)} ・
                      最終承認者 {proposal.finalApproverName}
                      {proposal.reviewerName ? ` ・ レビュー ${proposal.reviewerName}` : ""}
                      {` ・ ${proposalReviewStageLabel(proposal.reviewerUserId, proposal.reviewOutcome)}`}
                    </p>
                    <div className="mt-1.5">
                      <ProposalStages proposal={proposal} />
                    </div>
                  </div>
                  <button
                    type="button"
                    className={buttonQuiet}
                    onClick={() => onSelect(proposal.id)}
                    aria-haspopup="dialog"
                  >
                    {!proposal.invalidReview && proposal.status === "under_review" &&
                    canReview &&
                    proposal.reviewerUserId === currentUserId
                      ? "レビューする"
                      : !proposal.invalidReview && proposal.status === "pending_decision" &&
                          proposal.finalApproverUserId === currentUserId
                        ? "決裁する"
                        : "提案の詳細を見る"}
                  </button>
                </div>

                {proposal.restricted ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-warning-soft px-2.5 py-1.5 text-[11px] text-amber-900">
                    閲覧権限のない元プロジェクトを含むため、理由・合計・両案の内訳は非表示です。取り下げはこの詳細画面から行えます。
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
                    <span>
                      推奨 <b>{proposal.recommendedScenarioName}</b>
                    </span>
                    <span>
                      投資額{" "}
                      {formatManYen(
                        proposal.snapshot.scenarios[proposal.recommendedSlot].knownCostYen,
                      )}{" "}
                      万円
                    </span>
                    <span>
                      {proposal.snapshot.scenarios[proposal.recommendedSlot].overBudget
                        ? `予算超過 ${formatManYen(
                            -proposal.snapshot.scenarios[proposal.recommendedSlot]
                              .budgetRemainingYen,
                          )}`
                        : `予算残 ${formatManYen(
                            proposal.snapshot.scenarios[proposal.recommendedSlot]
                              .budgetRemainingYen,
                          )}`}{" "}
                      万円
                    </span>
                    <span>提出時の計画の版 {proposal.periodRevision}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <PlanningDialog
        open={selected !== null}
        onClose={() => onSelect(null)}
        title={selected ? proposalTitle(selected) : "投資提案"}
        wide
        footer={
          <button type="button" className={buttonSecondary} onClick={() => onSelect(null)}>
            閉じる
          </button>
        }
      >
        {selected && (
          <ProposalDetail
            proposal={selected}
            currentRevision={period.revision}
            currentUserId={currentUserId}
            canReview={canReview}
            canEdit={canEdit}
            onReview={(input) => onReview(selected.id, input)}
            onDecide={(input) => onDecide(selected.id, input)}
            onWithdraw={(input) => onWithdraw(selected.id, input)}
          />
        )}
      </PlanningDialog>
    </section>
  );
}
