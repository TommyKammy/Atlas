import Link from "next/link";
import { getInboxPage, getUsers, getWorkspace } from "@/lib/data";
import { inboxFilter, parseInboxCursor } from "@/lib/inbox-pagination";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { MarkAllReadButton, MarkReadButton } from "@/components/InboxButtons";
import InboxLive from "@/components/InboxLive";
import { formatDateTime } from "@/lib/dates";
import { isInboxItemUnread } from "@/lib/inbox-display";
import { quietButtonClass } from "@/components/ui/form-controls";
import {
  pageContentInsetClass,
  pageDescriptionClass,
  pageFixedClass,
  pageFrameClass,
  pageHeaderInsetClass,
  pageHeaderRowClass,
  pageScrollClass,
  pageTitleClass,
} from "@/components/ui/page-layout";

export const instant = false;

function EntryIcon({ entry }: { entry: "comment" | "event" }) {
  return (
    <span data-inbox-entry-icon className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted" aria-hidden="true">
      {entry === "comment" ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 3.5h10v6.5H7.5L4.5 13v-3H3z" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8.5 2 4 8.5h3L6.5 14 12 7H8.5z" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = inboxFilter(params.filter);
  let cursor = null;
  let invalidCursor = false;
  try { cursor = parseInboxCursor(params.cursor); } catch { invalidCursor = true; }
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const ws = await getWorkspace();
  const users = await getUsers(uid);
  const me = users.find((u) => u.id === uid) ?? null;
  const page = ws && me ? await getInboxPage(me.id, ws.id, { filter, cursor })
    : { items: [], total: 0, unread: 0, read: 0, all: 0, nextCursor: null };
  const { items } = page;

  const row = (c: (typeof items)[number], showButton: boolean) => {
    const mentioned =
      c.entry === "comment" && me != null && c.body.includes(`@${me.name}`);
    const unread = isInboxItemUnread(c, me?.id ?? null);
    return (
      <div
        key={`${c.entry}-${c.id}`}
        data-inbox-entry={`${c.entry}-${c.id}`}
        data-inbox-unread={unread ? "true" : undefined}
        className="flex min-h-[48px] items-start gap-3 border-b border-line-subtle py-2.5 pr-1 pl-1 hover:bg-hover"
      >
        <EntryIcon entry={c.entry} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="sr-only">{c.entry === "event" ? "更新: " : "コメント: "}</span>
            {unread && <span className="sr-only">未読: </span>}
            {unread && <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full bg-accent" />}
            <span className={`text-[13px] ${unread ? "font-semibold text-text" : "text-text"}`}>{c.author_name ?? "–"}</span>
            {c.entry === "event" ? (
              <span className="text-[13px] text-secondary">{c.body}</span>
            ) : (
              <span className="text-[13px] text-secondary">がコメントしました</span>
            )}
            <Link
              href={`/projects/${c.project_id}?view=list&task=${c.task_id}`}
              className={`min-w-0 truncate text-[13px] text-text hover:underline ${unread ? "font-semibold" : ""}`}
            >
              {c.task_name}
            </Link>
            <span data-inbox-meta className="text-[12px] text-muted">{c.project_name}</span>
            <span className="text-[12px] tabular-nums text-muted">#{c.task_id}</span>
            {mentioned && (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning">
                自分宛
              </span>
            )}
            <span className="ml-auto pl-2 text-[12px] tabular-nums whitespace-nowrap text-muted" data-inbox-time>{formatDateTime(c.created_at)}</span>
          </div>
          {c.entry === "comment" && (
            <p className="mt-1 line-clamp-2 text-[13px] whitespace-pre-wrap text-secondary" title={c.body}>{c.body}</p>
          )}
        </div>
        {showButton && (
          <div className="shrink-0 pt-0.5">
            {c.entry === "event" ? (
              <MarkReadButton eventId={c.id} />
            ) : (
              <MarkReadButton commentId={c.id} />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={pageFrameClass}>
      <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
      <div className="max-w-5xl">
        <div className={pageHeaderRowClass}>
          <h1 className={pageTitleClass}>受信トレイ</h1>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
            {ws && <MarkAllReadButton workspaceId={ws.id} />}
            <InboxLive />
          </div>
        </div>
        <p className={pageDescriptionClass}>自分宛の通知と更新を確認し、既読にできます。</p>
        <nav aria-label="通知の表示" className="mt-4 flex flex-wrap items-center gap-1 text-[13px]">
          {([["unread", "未読", page.unread], ["read", "既読・自分の投稿", page.read], ["all", "すべて", page.all]] as const).map(([key, label, count]) => {
            const selected = filter === key;
            return (
              <Link
                key={key}
                href={`/inbox?filter=${key}`}
                aria-current={selected ? "page" : undefined}
                data-inbox-filter={key}
                className={`inline-flex h-8 items-center rounded-md px-3 ${
                  selected
                    ? "bg-accent-soft font-medium text-accent-text"
                    : "text-secondary hover:bg-hover"
                }`}
              >
                {label}（<span className="tabular-nums text-muted">{count}</span>）
              </Link>
            );
          })}
        </nav>
      </div>
      </div>
      <div data-page-scroll className={`${pageScrollClass} ${pageContentInsetClass}`}>
      <div className="max-w-5xl">
        {invalidCursor && <p role="alert" className="mt-3 text-[13px] text-danger">通知の表示位置を読み込めなかったため、先頭から表示しています。</p>}
        <h2 data-inbox-total={page.total} className="mt-5 flex items-baseline gap-2 text-[13px] font-semibold text-text">
          対象の通知：<span className="text-[12px] font-normal tabular-nums text-muted">{page.total}件</span>
        </h2>
        {items.length === 0 && (
          <p className="mt-2 rounded-lg bg-surface-subtle px-3 py-2 text-[13px] text-muted">
            {filter === "unread" && page.total === 0 ? "未読はありません。" : "この位置に通知はありません。"}
          </p>
        )}
        <div className="mt-1">{items.map((item) => row(item, !item.is_read && item.author_id !== me?.id))}</div>
        <nav aria-label="通知のページ" className="mt-2 flex gap-1">
          {cursor && <Link href={`/inbox?filter=${filter}`} data-inbox-first className={quietButtonClass}>先頭へ戻る</Link>}
          {page.nextCursor && <Link href={`/inbox?filter=${filter}&cursor=${encodeURIComponent(page.nextCursor)}`} data-inbox-next className={quietButtonClass}>次の通知を表示</Link>}
        </nav>
      </div>
      </div>
    </div>
  );
}
