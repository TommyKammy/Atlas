import {
  formatDecisionDate,
  formatManYen,
  periodLabel,
  quarterStartMonth,
} from "@/lib/planning/format";
import {
  proposalReviewOutcomeLabel,
  proposalReviewStageLabel,
} from "@/lib/planning/approvals";
import type { PlanningDecision, PlanningProposal } from "@/lib/planning/types";
import ScenarioSnapshotView from "./ScenarioSnapshot";
import { EmptyPanel, Notice, Tag } from "./ui";

function ProposalTrail({
  proposal,
  decisionReason,
  decisionActorName,
  decidedAt,
}: {
  proposal: PlanningProposal;
  decisionReason: string;
  decisionActorName: string;
  decidedAt: string;
}) {
  if (proposal.restricted) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        この提案の詳細は閲覧権限のため表示できません。
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-950">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-blue-900">
        <span>提案（版{proposal.version}）から採用</span>
        <a href="#proposal-history" className="font-normal underline">
          提案履歴を見る
        </a>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-blue-800">
          申請者の理由 ・ {proposal.submitterName} ・ {formatDecisionDate(proposal.submittedAt)}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap">{proposal.reason}</p>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-blue-800">
          レビューの回答 ・ {proposalReviewStageLabel(proposal.reviewerUserId, proposal.reviewOutcome)}
          {proposal.reviewerName ? `（${proposal.reviewerName}）` : ""}
          {proposal.reviewedAt ? ` ・ ${formatDecisionDate(proposal.reviewedAt)}` : ""}
        </div>
        {proposal.reviewNote ? (
          <p className="mt-0.5 whitespace-pre-wrap">{proposal.reviewNote}</p>
        ) : (
          <p className="mt-0.5 text-blue-800">
            {proposal.reviewOutcome === "not_required"
              ? "レビューは省略されました。"
              : proposalReviewOutcomeLabel(proposal.reviewOutcome ?? "not_required")}
          </p>
        )}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-blue-800">
          最終決裁の理由 ・ {decisionActorName} ・ {formatDecisionDate(decidedAt)}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap">{decisionReason}</p>
      </div>
    </div>
  );
}

export default function DecisionHistory({
  decisions,
  proposals = [],
  approvalEnabled = false,
}: {
  decisions: PlanningDecision[];
  proposals?: PlanningProposal[];
  approvalEnabled?: boolean;
}) {
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
            {approvalEnabled
              ? "承認フローでは、提出済みの投資提案を最終承認者が決定すると、その時点の内容がここに採用記録として追加されます。"
              : "比較画面でA案またはB案を採用すると、両案の前提と結果、理由、実行者、日時がここに記録されます。"}
          </EmptyPanel>
        </div>
      ) : (
        <ol className="mt-3 space-y-4">
          {decisions.map((decision) => {
            const source =
              decision.sourceProposalId === null
                ? null
                : proposals.find((proposal) => proposal.id === decision.sourceProposalId) ?? null;
            return (
              <li key={decision.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-neutral-900">
                        {decision.chosenScenarioName
                          ? `${decision.chosenScenarioName}を採用`
                          : "採用案（非表示）"}
                      </h3>
                      {decision.sourceProposalId !== null && (
                        <Tag tone="blue">提案から採用</Tag>
                      )}
                      {decision.restricted && <Tag tone="warn">閲覧制限</Tag>}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {formatDecisionDate(decision.decidedAt)} ・ {decision.actorName}
                      {decision.periodRevision !== undefined
                        ? ` ・ 版 ${decision.periodRevision}`
                        : ""}
                      {decision.budgetYen !== undefined
                        ? ` ・ 予算 ${formatManYen(decision.budgetYen)} 万円`
                        : ""}
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
                    {source && (
                      <ProposalTrail
                        proposal={source}
                        decisionReason={decision.reason}
                        decisionActorName={decision.actorName}
                        decidedAt={decision.decidedAt}
                      />
                    )}
                    {!source && (
                      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-800">
                        <span className="font-semibold">採用理由</span>
                        <p className="mt-1 whitespace-pre-wrap">{decision.reason}</p>
                      </div>
                    )}
                    <p className="text-[11px] text-neutral-500">
                      対象期間:{" "}
                      {periodLabel(
                        decision.snapshot.period.year,
                        decision.snapshot.period.quarter,
                      )}{" "}
                      ／ 予算 {formatManYen(decision.snapshot.period.budgetYen)} 万円
                    </p>
                    <div className="space-y-3">
                      {decision.snapshot.scenarios.map((scenario) => (
                        <ScenarioSnapshotView
                          key={scenario.slot}
                          scenario={scenario}
                          highlighted={scenario.slot === decision.chosenSlot}
                          startMonth={quarterStartMonth(decision.snapshot.period.quarter)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
