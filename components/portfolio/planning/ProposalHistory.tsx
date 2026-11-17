"use client";

import {
  formatDecisionDate,
  formatManYen,
  periodLabel,
  quarterStartMonth,
} from "@/lib/planning/format";
import { proposalStatusLabel } from "@/lib/planning/approvals";
import type {
  PlanningPeriodSummary,
  PlanningProposal,
  PlanningProposalStatus,
} from "@/lib/planning/types";
import PlanningDialog from "./PlanningDialog";
import ScenarioSnapshotView from "./ScenarioSnapshot";
import { buttonQuiet, buttonSecondary, EmptyPanel, Notice, Tag } from "./ui";

function statusTone(status: PlanningProposalStatus): "neutral" | "blue" | "good" | "warn" | "bad" {
  if (status === "submitted" || status === "under_review") return "blue";
  if (status === "approved") return "good";
  if (status === "returned" || status === "rejected") return "bad";
  return "neutral";
}

function proposalTitle(proposal: PlanningProposal): string {
  return `投資提案（版${proposal.version}）`;
}

function ProposalDetail({
  proposal,
  currentRevision,
}: {
  proposal: PlanningProposal;
  currentRevision: number;
}) {
  const snapshot = proposal.snapshot;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={statusTone(proposal.status)}>{proposalStatusLabel(proposal.status)}</Tag>
        <span className="text-[12px] font-medium text-neutral-800">{proposalTitle(proposal)}</span>
        {proposal.restricted && <Tag tone="warn">閲覧制限</Tag>}
      </div>

      <dl className="grid gap-x-4 gap-y-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-neutral-500">対象期間</dt>
          <dd className="font-medium text-neutral-800">
            {snapshot
              ? periodLabel(snapshot.period.year, snapshot.period.quarter)
              : "閲覧制限のため非表示"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">提出者 / 提出日時</dt>
          <dd className="font-medium text-neutral-800">
            {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">最終承認者</dt>
          <dd className="font-medium text-neutral-800">{proposal.finalApproverName}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">レビュー担当</dt>
          <dd className="font-medium text-neutral-800">{proposal.reviewerName ?? "レビューなし"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">提出時の計画の版 / 現在の版</dt>
          <dd className="font-medium text-neutral-800">
            {proposal.periodRevision} / {currentRevision}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">予算</dt>
          <dd className="font-medium text-neutral-800">{formatManYen(proposal.budgetYen)} 万円</dd>
        </div>
      </dl>

      {proposal.restricted || !snapshot ? (
        <Notice tone="warn">
          この提案には閲覧権限のない元プロジェクトに紐づく案件が含まれるため、理由・推奨シナリオ・両案の内訳・合計を表示できません。全案件の元プロジェクト閲覧権限が必要です。
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
            <div className="mt-1 text-[11px] text-blue-800">提案理由</div>
            <p className="mt-0.5 whitespace-pre-wrap">{proposal.reason}</p>
          </div>
          <div className="space-y-3">
            {snapshot.scenarios.map((scenario) => (
              <ScenarioSnapshotView
                key={scenario.slot}
                scenario={scenario}
                highlighted={scenario.slot === proposal.recommendedSlot}
                startMonth={quarterStartMonth(snapshot.period.quarter)}
                highlightLabel="推奨"
                snapshotLabel="提出時点"
              />
            ))}
          </div>
        </>
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
}: {
  proposals: PlanningProposal[];
  period: PlanningPeriodSummary;
  approvalEnabled: boolean;
  selectedId: number | null;
  onSelect: (proposalId: number | null) => void;
}) {
  const selected = proposals.find((proposal) => proposal.id === selectedId) ?? null;

  return (
    <section id="proposal-history" className="scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">投資提案</h2>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            提出時点のA案・B案と推奨シナリオを固定して保存しています。現在の計画とは別の内容です。
          </p>
        </div>
        <span className="text-[11px] text-neutral-500">{proposals.length}件</span>
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
            const snapshot = proposal.snapshot;
            return (
              <li
                key={proposal.id}
                className="rounded-lg border border-neutral-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-neutral-900">
                        {proposalTitle(proposal)}
                      </h3>
                      <Tag tone={statusTone(proposal.status)}>
                        {proposalStatusLabel(proposal.status)}
                      </Tag>
                      {proposal.restricted && <Tag tone="warn">閲覧制限</Tag>}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)} ・
                      最終承認者 {proposal.finalApproverName}
                      {proposal.reviewerName ? ` ・ レビュー ${proposal.reviewerName}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonQuiet}
                    onClick={() => onSelect(proposal.id)}
                    aria-haspopup="dialog"
                  >
                    提案の詳細を見る
                  </button>
                </div>

                {proposal.restricted || !snapshot ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                    閲覧権限のない元プロジェクトを含むため、理由・合計・両案の内訳は非表示です。
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-700">
                    <span>
                      推奨 <b>{proposal.recommendedScenarioName}</b>
                    </span>
                    <span>投資額 {formatManYen(snapshot.scenarios[proposal.recommendedSlot].knownCostYen)} 万円</span>
                    <span>
                      {snapshot.scenarios[proposal.recommendedSlot].overBudget
                        ? `予算超過 ${formatManYen(-snapshot.scenarios[proposal.recommendedSlot].budgetRemainingYen)}`
                        : `予算残 ${formatManYen(snapshot.scenarios[proposal.recommendedSlot].budgetRemainingYen)}`}{" "}
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
          <ProposalDetail proposal={selected} currentRevision={period.revision} />
        )}
      </PlanningDialog>
    </section>
  );
}
