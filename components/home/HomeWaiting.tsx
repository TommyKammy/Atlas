import Link from "next/link";
import { formatBudgetYen, formatProposalSubmittedDate, formatRelativeTime } from "@/lib/home-summary";
import type { InboxItem } from "@/lib/notification-feed";
import type { HomeWaitingProposal } from "@/lib/planning/home-waiting";

function inboxAction(item: InboxItem): string {
  return item.entry === "comment" ? "がコメントしました" : `が${item.body}`;
}

/** The right-hand side of the fixed home area: decisions and the inbox. */
export default function HomeWaiting({
  proposals,
  inboxItems,
  now,
}: {
  proposals: HomeWaitingProposal[];
  inboxItems: InboxItem[];
  now: string;
}) {
  return (
    <aside aria-label="あなたの対応待ち" className="flex min-w-0 flex-col gap-5">
      <h2 className="sr-only">あなたの対応待ち</h2>
      {proposals.length > 0 && (
        <div className="flex flex-col gap-3">
          {proposals.map((proposal) => (
            <article
              key={proposal.id}
              data-home-decision-proposal={proposal.id}
              className="rounded-lg border border-line bg-surface-subtle p-4"
            >
              <h3 className="text-[12px] font-bold text-accent-text">あなたの決裁待ち</h3>
              <p className="mt-2 text-[15px] font-bold leading-6 text-text">
                {proposal.portfolioName}
              </p>
              <p className="mt-0.5 text-[12px] text-secondary">
                {proposal.periodLabel} ・ 第{proposal.version}版 ・ {proposal.stageLabel}
              </p>
              <dl className="mt-3 grid grid-cols-[48px_minmax(0,1fr)] gap-y-1.5 text-[12px]">
                <dt className="text-muted">申請</dt>
                <dd className="min-w-0 text-text">
                  {proposal.submitterName} ・ {formatProposalSubmittedDate(proposal.submittedAt)}
                </dd>
                <dt className="text-muted">予算</dt>
                <dd className="text-text">{formatBudgetYen(proposal.budgetYen)}</dd>
              </dl>
              <Link
                href={proposal.href}
                className="mt-4 flex h-11 items-center justify-center rounded-lg bg-accent px-3 text-center text-[13px] font-bold text-on-accent hover:bg-accent-hover"
              >
                {proposal.mode === "review" ? "内容を確認する" : "内容を確認して決裁する"}
              </Link>
            </article>
          ))}
        </div>
      )}

      <section data-home-inbox aria-labelledby="home-inbox-title">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="home-inbox-title" className="text-[13px] font-bold text-text">
            受信トレイ
          </h3>
          <Link href="/inbox" className="text-[12px] text-accent-text hover:underline">
            すべて見る
          </Link>
        </div>
        {inboxItems.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">新しい通知はありません</p>
        ) : (
          <div className="mt-1 flex flex-col">
            {inboxItems.map((item) => (
              <Link
                key={`${item.entry}-${item.id}`}
                href={`/projects/${item.project_id}?view=list&task=${item.task_id}`}
                data-home-inbox-item={`${item.entry}-${item.id}`}
                className="flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2.5 hover:bg-hover"
              >
                <span className="line-clamp-2 text-[12px] leading-5 text-secondary">
                  <b className="font-semibold text-text">
                    {item.author_name ?? "不明なユーザー"}
                  </b>
                  {inboxAction(item)}
                </span>
                <span className="truncate text-[12px] text-secondary" title={item.task_name}>
                  {item.task_name}
                </span>
                <span className="text-[11px] text-muted">
                  {formatRelativeTime(item.created_at, now)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
