import Link from "next/link";
import NewProjectForm from "@/components/NewProjectForm";
import ProjectTemplateBar from "@/components/ProjectTemplateBar";
import NavPending from "@/components/NavPending";
import { getMyTasks, getProjectsForUser, getProjectTemplateList, getUnreadCount, getUsers, getWorkspace } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";

export const instant = false;

export default async function Home() {
  const ws = await getWorkspace();
  if (!ws) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">Atlas</h1>
        <p className="mt-2 text-neutral-600">
          ワークスペースがありません。DB初期化（db/init.sql + seed）を確認してください。
        </p>
      </div>
    );
  }
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  const [projects, templates, myTasks, unread] = await Promise.all([
    me ? getProjectsForUser(ws.id, me.id) : Promise.resolve([]),
    getProjectTemplateList(ws.id),
    me ? getMyTasks(me.id) : Promise.resolve([]),
    me ? getUnreadCount(me.id, ws.id) : Promise.resolve(0),
  ]);
  const today = todayISO();
  const overdue = myTasks.filter((t) => t.due_on !== null && t.due_on < today);
  const dueToday = myTasks.filter((t) => t.due_on === today);
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 11 ? "おはようございます" : hour < 18 ? "こんにちは" : "こんばんは";
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLine = `${now.getMonth() + 1}月 ${now.getDate()}日 ${weekdays[now.getDay()]}曜日`;
  return (
    <div className="px-8 py-6 pb-16">
      <div className="text-sm text-neutral-800">{dateLine}</div>
      <h1 className="mt-1 text-[32px] font-normal leading-10 text-neutral-900">
        {me?.name ?? ""} さん、{greet}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/my-tasks" className="rounded-md border bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50">
          マイタスク（担当 {myTasks.length}）
          <NavPending className="ml-1" />
        </Link>
        <Link href="/inbox" className="rounded-md border bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50">
          受信トレイ（未読 {unread}）
          <NavPending className="ml-1" />
        </Link>
      </div>
      {overdue.length > 0 && (
        <section className="mt-8 max-w-3xl">
          <h2 className="text-sm font-semibold text-neutral-700">期限超過 ({overdue.length} 件)</h2>
          <div className="mt-1">
            {overdue.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                href={`/projects/${t.project_id}?view=list&task=${t.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">{t.project_name}</span>
                <span className="w-24 shrink-0 text-right text-xs font-semibold text-red-600">{t.due_on}</span>
                <NavPending className="ml-1" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {dueToday.length > 0 && (
        <section className="mt-6 max-w-3xl">
          <h2 className="text-sm font-semibold text-neutral-700">まもなく期限のタスク ({dueToday.length} 件)</h2>
          <div className="mt-1">
            {dueToday.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                href={`/projects/${t.project_id}?view=list&task=${t.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">{t.project_name}</span>
                <span className="w-24 shrink-0 text-right text-xs text-neutral-600">{t.due_on}</span>
                <NavPending className="ml-1" />
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-700">プロジェクト</h2>
        {projects.length === 0 && <p className="mt-4 text-neutral-600">プロジェクトがありません。</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <NewProjectForm workspaceId={ws.id} />
        </div>
        <div className="mt-2 grid max-w-4xl grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}?view=list`}
              className="flex items-center gap-2.5 rounded-lg px-3 py-3 hover:bg-neutral-50"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-teal-600 text-sm font-bold text-white">
                {p.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">{p.name}</span>
              <NavPending className="ml-auto" />
            </Link>
          ))}
        </div>
      </section>
      <ProjectTemplateBar workspaceId={ws.id} projects={projects} initial={templates} />
    </div>
  );
}
