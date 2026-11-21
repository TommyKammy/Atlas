import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/current-user";
import { hasPermission } from "@/lib/permissions";
import { getAuditLog } from "@/lib/audit";
import { getWorkspace } from "@/lib/data";
import { auditActorLabel, auditTimestampISO, formatAuditTimestamp } from "@/lib/audit-display";
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

export default async function AuditPage() {
  const user = await requirePageUser();
  if (!user.isAdmin || !(await hasPermission(user.id, "audit.view"))) redirect("/");
  const ws = await getWorkspace();
  const rows = ws ? await getAuditLog(ws.id) : [];

  return (
    <div className={pageFrameClass}>
      <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
      <div className="max-w-5xl">
        <div className={pageHeaderRowClass}>
          <h1 className={pageTitleClass}>監査ログ</h1>
          <div className="ml-auto flex items-center gap-1">
            <a href="/api/admin/audit/export?format=json" data-audit-export="json" className={quietButtonClass}>
              JSON
            </a>
            <a href="/api/admin/audit/export?format=csv" data-audit-export="csv" className={quietButtonClass}>
              CSV
            </a>
          </div>
        </div>
        <p className={pageDescriptionClass}>
          {ws?.name} の変更履歴（<span className="tabular-nums">{rows.length}</span>件・直近200件）
        </p>
      </div>
      </div>
      <div data-page-scroll className={`${pageScrollClass} ${pageContentInsetClass}`}>
      <div className="max-w-5xl">
        <div data-audit-table-scroll className="mt-5 overflow-x-auto">
          <table data-audit-table className="w-full min-w-[860px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[150px]" />
              <col className="w-[130px]" />
              <col className="w-[210px]" />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-2 py-2 text-[12px] font-medium text-muted">日時</th>
                <th scope="col" className="px-2 py-2 text-[12px] font-medium text-muted">操作者</th>
                <th scope="col" className="px-2 py-2 text-[12px] font-medium text-muted">操作</th>
                <th scope="col" className="px-2 py-2 text-[12px] font-medium text-muted">対象</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const target = [r.project_name, r.summary].filter(Boolean).join(" / ") || `${r.entity}#${r.entity_id ?? "–"}`;
                const actor = auditActorLabel(r.actor_name, r.action);
                return (
                  <tr key={r.id} data-audit-row={r.id} className="border-b border-line-subtle hover:bg-hover">
                    <td className="px-2 py-2 align-top">
                      <time
                        dateTime={auditTimestampISO(r.created_at)}
                        title={r.created_at}
                        className="block text-[12px] tabular-nums whitespace-nowrap text-muted"
                      >
                        {formatAuditTimestamp(r.created_at)}
                      </time>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span className="block truncate text-[13px] text-secondary" title={actor}>
                        {actor}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span
                        className="inline-block max-w-full truncate rounded bg-surface-muted px-1.5 py-0.5 align-top font-mono text-[12px] text-secondary"
                        title={r.action}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span className="line-clamp-2 text-[13px] text-secondary" title={target}>
                        {target}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="mt-4 text-[13px] text-muted">履歴はありません。</p>}
      </div>
      </div>
    </div>
  );
}
