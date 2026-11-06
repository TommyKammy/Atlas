import Link from "next/link";
import { getInbox, getUsers, getWorkspace } from "@/lib/data";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { MarkAllReadButton, MarkReadButton } from "@/components/InboxButtons";
import InboxLive from "@/components/InboxLive";

export const instant = false;

export default async function InboxPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const ws = await getWorkspace();
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  const items = ws && me ? await getInbox(me.id, ws.id) : [];
  const unread = items.filter((c) => !c.is_read && c.author_id !== me?.id);
  const rest = items.filter((c) => !(!c.is_read && c.author_id !== me?.id));

  const row = (c: (typeof items)[number], showButton: boolean) => {
    const mentioned =
      c.entry === "comment" && me != null && c.body.includes(`@${me.name}`);
    return (
      <div key={`${c.entry}-${c.id}`} className="border-b py-3 text-sm hover:bg-neutral-50">
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
      <h2 className="mt-4 font-semibold">未読（{unread.length}）</h2>
      {unread.length === 0 && <p className="mt-1 text-sm text-neutral-500">未読はありません。</p>}
      <div className="max-w-4xl">{unread.map((c) => row(c, true))}</div>
      <h2 className="mt-6 font-semibold text-neutral-500">既読・自分の投稿（{rest.length}）</h2>
      <div className="max-w-4xl opacity-75">{rest.map((c) => row(c, false))}</div>
    </div>
  );
}
