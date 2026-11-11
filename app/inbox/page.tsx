import Link from "next/link";
import { getInboxPage, getUsers, getWorkspace } from "@/lib/data";
import { inboxFilter, parseInboxCursor } from "@/lib/inbox-pagination";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { MarkAllReadButton, MarkReadButton } from "@/components/InboxButtons";
import InboxLive from "@/components/InboxLive";

export const instant = false;

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = inboxFilter(params.filter);
  let cursor = null;
  let invalidCursor = false;
  try { cursor = parseInboxCursor(params.cursor); } catch { invalidCursor = true; }
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const ws = await getWorkspace();
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  const page = ws && me ? await getInboxPage(me.id, ws.id, { filter, cursor })
    : { items: [], total: 0, unread: 0, read: 0, all: 0, nextCursor: null };
  const { items } = page;

  const row = (c: (typeof items)[number], showButton: boolean) => {
    const mentioned =
      c.entry === "comment" && me != null && c.body.includes(`@${me.name}`);
    return (
      <div key={`${c.entry}-${c.id}`} data-inbox-entry={`${c.entry}-${c.id}`} className="border-b py-3 text-sm hover:bg-neutral-50">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{c.entry === "event" ? "⚡" : "💬"}</span>
          <span>{c.author_name ?? "–"}</span>
          <span>{c.entry === "event" ? c.body : "→"}</span>
          <Link
            href={`/projects/${c.project_id}?view=list&task=${c.task_id}`}
            className="font-semibold text-neutral-700 hover:underline"
          >
            {c.task_name}
          </Link>
          <span>（{c.project_name}）</span>
          {mentioned && (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 font-semibold text-amber-900">
              自分宛
            </span>
          )}
          <span className="flex-1" />
          {showButton &&
            (c.entry === "event" ? (
              <MarkReadButton eventId={c.id} />
            ) : (
              <MarkReadButton commentId={c.id} />
            ))}
        </div>
        {c.entry === "comment" && <div className="mt-1 whitespace-pre-wrap">{c.body}</div>}
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">受信トレイ</h1>
        {ws && <MarkAllReadButton workspaceId={ws.id} />}
        <InboxLive />
      </div>
      <nav aria-label="通知の表示" className="mt-4 flex flex-wrap gap-2 text-sm">
        {[["unread", `未読（${page.unread}）`], ["read", `既読・自分の投稿（${page.read}）`], ["all", `すべて（${page.all}）`]].map(([key, label]) =>
          <Link key={key} href={`/inbox?filter=${key}`} aria-current={filter === key ? "page" : undefined}
            data-inbox-filter={key} className={`rounded border px-3 py-1 ${filter === key ? "border-blue-300 bg-blue-50 text-blue-800" : "text-neutral-600"}`}>{label}</Link>)}
      </nav>
      {invalidCursor && <p role="alert" className="mt-3 text-sm text-rose-700">通知の表示位置を読み込めなかったため、先頭から表示しています。</p>}
      <h2 data-inbox-total={page.total} className="mt-4 font-semibold">対象の通知：{page.total}件</h2>
      {items.length === 0 && <p className="mt-1 text-sm text-neutral-500">{filter === "unread" && page.total === 0 ? "未読はありません。" : "この位置に通知はありません。"}</p>}
      <div className="max-w-4xl">{items.map((item) => row(item, !item.is_read && item.author_id !== me?.id))}</div>
      <nav aria-label="通知のページ" className="mt-4 flex gap-4 text-sm text-blue-700">
        {cursor && <Link href={`/inbox?filter=${filter}`} data-inbox-first>先頭へ戻る</Link>}
        {page.nextCursor && <Link href={`/inbox?filter=${filter}&cursor=${encodeURIComponent(page.nextCursor)}`} data-inbox-next>次の通知を表示</Link>}
      </nav>
    </div>
  );
}
