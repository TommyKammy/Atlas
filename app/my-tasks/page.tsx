import Link from "next/link";
import { getMyTasks, getUsers } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { shiftDate } from "@/lib/timeline-dnd";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";

export const instant = false;

export default async function MyTasksPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  const tasks = me ? await getMyTasks(me.id) : [];
  const today = todayISO();
  const weekEnd = shiftDate(today, 7);

  const buckets: { key: string; label: string; items: typeof tasks; alert?: boolean }[] = [
    { key: "overdue", label: "期限超過", items: [], alert: true },
    { key: "today", label: "今日が期日", items: [] },
    { key: "week", label: "今週", items: [] },
    { key: "later", label: "それ以降・未設定", items: [] },
  ];
  for (const t of tasks) {
    if (t.due_on !== null && t.due_on < today) buckets[0].items.push(t);
    else if (t.due_on === today) buckets[1].items.push(t);
    else if (t.due_on !== null && t.due_on <= weekEnd) buckets[2].items.push(t);
    else buckets[3].items.push(t);
  }

  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">マイタスク（{me?.name ?? "–"}）</h1>
      <p className="mt-1 text-sm text-neutral-500">未完了・担当が自分・全プロジェクト横断</p>
      {tasks.length === 0 && <p className="mt-4 text-neutral-600">割当タスクはありません。</p>}
      <div className="mt-4 max-w-4xl">
        {buckets.map((b) => (
          <div key={b.key} className="mb-5">
            <h2 className={`font-semibold ${b.alert && b.items.length > 0 ? "text-red-700" : ""}`}>
              {b.label}（{b.items.length}）
            </h2>
            {b.items.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b py-2 text-sm hover:bg-neutral-50"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-400" />
                <Link
                  href={`/projects/${t.project_id}?view=list&task=${t.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {t.name}
                </Link>
                <span className="shrink-0 text-xs text-neutral-500">{t.project_name ?? "–"}</span>
                <span
                  className={`w-24 shrink-0 ${
                    b.alert ? "font-semibold text-red-600" : "text-neutral-600"
                  }`}
                >
                  {t.due_on ?? "–"}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
