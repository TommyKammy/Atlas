import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { csvResponse, toCsv } from "@/lib/csv";

export const GET = withProject("view", async (req, { projectId }) => {
  const id = projectId;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") throw badRequest("format must be json or csv");
  const daysRaw = Number(searchParams.get("days"));
  const days = [7, 14, 30].includes(daysRaw) ? daysRaw : 14;

  const p = await db.query(
    "SELECT id, name, status_field_enabled FROM projects WHERE id = $1::bigint",
    [projectId],
  );
  const project = p.rows[0] as { id: number; name: string; status_field_enabled: boolean };
  const statusFieldEnabled = project.status_field_enabled !== false;

  const totals = await db.query(
    `SELECT COUNT(*) FILTER (WHERE parent_task_id IS NULL AND deleted_at IS NULL)::int AS total,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND deleted_at IS NULL AND completed)::int AS done,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND deleted_at IS NULL AND NOT completed AND due_on < CURRENT_DATE)::int AS overdue
     FROM tasks WHERE project_id = $1::bigint`,
    [id],
  );
  const bySection = await db.query(
    `SELECT s.name, COUNT(t.id)::int AS total, COUNT(t.id) FILTER (WHERE t.completed)::int AS done
     FROM sections s LEFT JOIN tasks t ON t.section_id = s.id AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     WHERE s.project_id = $1::bigint GROUP BY s.id ORDER BY s.position, s.id`,
    [id],
  );
  const byAssignee = await db.query(
    `SELECT u.name, COUNT(t.id)::int AS open
     FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1::bigint AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed
     GROUP BY u.id, u.name ORDER BY 2 DESC, u.id`,
    [id],
  );
  const byStatus = statusFieldEnabled
    ? await db.query(
        `SELECT status, COUNT(*)::int AS n FROM tasks
         WHERE project_id = $1::bigint AND parent_task_id IS NULL AND deleted_at IS NULL GROUP BY status ORDER BY n DESC, status`,
        [id],
      )
    : { rows: [] as { status: string; n: number }[] };
  const trend = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(e.id)::int AS n
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d
     LEFT JOIN task_events e ON e.kind = 'completed' AND e.created_at::date = d::date
       AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = e.task_id AND t.project_id = $1::bigint AND t.deleted_at IS NULL)
     GROUP BY d ORDER BY d`,
    [id, days],
  );

  const payload = {
    exported_at: new Date().toISOString(),
    project,
    days,
    totals: totals.rows[0],
    bySection: bySection.rows,
    byAssignee: byAssignee.rows,
    status_field_enabled: statusFieldEnabled,
    byStatus: byStatus.rows,
    trend: trend.rows,
  };

  const safeName = `${project.name.replace(/[^\w\-ぁ-んァ-ン一-龯ー]+/g, "_").slice(0, 80) || "project"}-dashboard`;
  if (format === "json") {
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.json`)}`,
      },
    });
  }
  const rows: unknown[][] = [["種別", "項目", "完了", "全体", "備考"]];
  const t = totals.rows[0] as { total: number; done: number; overdue: number };
  rows.push(["サマリ", "全体", t.done, t.total, `期限超過:${t.overdue}`]);
  for (const s of bySection.rows as { name: string; total: number; done: number }[]) {
    rows.push(["セクション", s.name, s.done, s.total, ""]);
  }
  for (const a of byAssignee.rows as { name: string; open: number }[]) {
    rows.push(["担当者(未完了)", a.name, "", a.open, ""]);
  }
  for (const s of byStatus.rows as { status: string; n: number }[]) {
    rows.push(["Status", s.status, "", s.n, ""]);
  }
  for (const d of trend.rows as { day: string; n: number }[]) {
    rows.push(["日別完了", d.day, d.n, "", ""]);
  }
  return csvResponse(`${safeName}.csv`, toCsv(rows));
});
