import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/current-user";
import { hasPermission } from "@/lib/permissions";
import { getAuditLog } from "@/lib/audit";
import { getWorkspace } from "@/lib/data";

export const instant = false;

export default async function AuditPage() {
  const user = await requirePageUser();
  if (!user.isAdmin || !(await hasPermission(user.id, "audit.view"))) redirect("/");
  const ws = await getWorkspace();
  const rows = ws ? await getAuditLog(ws.id) : [];

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">監査ログ</h1>
        <a href="/api/admin/audit/export?format=json" className="text-sm text-blue-700 hover:underline">
          JSON
        </a>
        <a href="/api/admin/audit/export?format=csv" className="text-sm text-blue-700 hover:underline">
          CSV
        </a>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        {ws?.name} の変更履歴（{rows.length}件・直近200件）
      </p>
      <div className="mt-4 max-w-5xl">
        <div className="grid grid-cols-[170px_120px_140px_minmax(0,1fr)] gap-2 border-b px-2 py-2 text-xs font-semibold text-neutral-500">
          <span>日時</span>
          <span>操作者</span>
          <span>操作</span>
          <span>対象</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[170px_120px_140px_minmax(0,1fr)] gap-2 border-b px-2 py-1.5 text-sm"
          >
            <span className="text-neutral-500">{r.created_at}</span>
            <span className="truncate">{r.actor_name ?? "–"}</span>
            <span className="break-all font-mono text-xs">{r.action}</span>
            <span className="break-words text-neutral-700">
              {[r.project_name, r.summary].filter(Boolean).join(" / ") || `${r.entity}#${r.entity_id ?? "–"}`}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="mt-4 text-sm text-neutral-500">履歴はありません。</p>}
      </div>
    </div>
  );
}
