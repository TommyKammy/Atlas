import Link from "next/link";
import { formatBudgetYen, formatProposalSubmittedDate, formatRelativeTime } from "@/lib/home-summary";
import type { InboxItem } from "@/lib/notification-feed";
import type { HomeWaitingProposal } from "@/lib/planning/home-waiting";
import UserAvatar from "../UserAvatar";

function inboxAction(item: InboxItem): string {
  return item.entry === "comment" ? "がコメントしました" : `が${item.body}`;
}

/** The right-hand side of the fixed home area: decisions and the inbox. */
export default function HomeWaiting({
  proposals,
  inboxItems,
  now,
  viewerId,
  users,
}: {
  proposals: HomeWaitingProposal[];
  inboxItems: InboxItem[];
  now: string;
  viewerId: number;
  users: { id: number; avatar_url?: string | null }[];
}) {
  // Same rule as the inbox: your own activity never counts as unread.
  const isUnread = (item: InboxItem) => !item.is_read && item.author_id !== viewerId;
  const avatarOf = (authorId: number | null) => users.find((user) => user.id === authorId)?.avatar_url ?? null;
  const unread = inboxItems.filter(isUnread).length;
  return (
    <aside aria-label="あなたの対応待ち" className="flex min-w-0 flex-col gap-5">
      <h2 className="sr-only">あなたの対応待ち</h2>
      {proposals.length > 0 && (
        <div className="flex flex-col gap-3">
          {proposals.map((proposal) => (
            <article
              key={proposal.id}
              data-home-decision-proposal={proposal.id}
              className="rounded-[10px] border border-line bg-surface p-4 shadow-card"
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

      <section
        data-home-inbox
        aria-labelledby="home-inbox-title"
        className="rounded-[10px] border border-line bg-surface shadow-card"
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
          <h3 id="home-inbox-title" className="text-[14px] font-bold text-text">
            受信トレイ
          </h3>
          {unread > 0 && (
            <span className="rounded-full bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-secondary">
              {unread} 未読
            </span>
          )}
          <span className="flex-1" />
          <Link href="/inbox" className="text-[12px] font-semibold text-accent-text hover:underline">
            すべて見る
          </Link>
        </div>
        {inboxItems.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-muted">新しい通知はありません</p>
        ) : (
          <div className="flex flex-col px-2 pb-2">
            {inboxItems.map((item) => {
              const itemUnread = isUnread(item);
              return (
                <Link
                  key={`${item.entry}-${item.id}`}
                  href={`/projects/${item.project_id}?view=list&task=${item.task_id}`}
                  data-home-inbox-item={`${item.entry}-${item.id}`}
                  data-unread={itemUnread ? "true" : undefined}
                  className="grid min-w-0 grid-cols-[6px_24px_minmax(0,1fr)] items-start gap-2.5 rounded-md px-2 py-2.5 hover:bg-hover"
                >
                  <span
                    aria-hidden
                    className={`mt-[9px] h-1.5 w-1.5 rounded-full ${itemUnread ? "bg-accent" : ""}`}
                  />
                  <UserAvatar
                    name={item.author_name}
                    url={avatarOf(item.author_id)}
                    className="h-6 w-6"
                    textClassName="text-[9px]"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {itemUnread && <span className="sr-only">未読: </span>}
                    <span className={`line-clamp-2 text-[12px] leading-5 ${itemUnread ? "text-secondary" : "text-muted"}`}>
                      <b className="font-semibold text-text">
                        {item.author_name ?? "不明なユーザー"}
                      </b>
                      {inboxAction(item)}
                    </span>
                    <span className="flex min-w-0 items-baseline gap-2 text-[11px]">
                      <span className="truncate font-semibold text-secondary" title={item.task_name}>
                        {item.task_name}
                      </span>
                      <span className="shrink-0 text-subtle">{formatRelativeTime(item.created_at, now)}</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}
