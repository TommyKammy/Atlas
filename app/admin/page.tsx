import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import AdminPanel from "@/components/AdminPanel";
import UsageStats from "@/components/UsageStats";

export const instant = false;

export default async function AdminPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const me = uid === null ? null : (await db.query("SELECT is_admin FROM users WHERE id = $1", [uid])).rows[0] as
    | { is_admin: boolean }
    | undefined;
  if (!me?.is_admin) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">管理</h1>
        <p className="mt-2 text-sm text-neutral-500">管理者権限が必要です。</p>
      </div>
    );
  }
  const users = (
    await db.query(
      `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
         (SELECT COUNT(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND NOT t.completed) AS open_tasks
       FROM users u ORDER BY u.id`,
    )
  ).rows;
  return (
    <div className="max-w-6xl p-6">
      <h1 className="text-lg font-bold">管理</h1>
      <AdminPanel initial={users} currentUserId={uid ?? 1} />
      <UsageStats />
    </div>
  );
}
