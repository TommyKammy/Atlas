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
  const p = await db.query("SELECT id, name FROM projects WHERE id = $1::bigint", [projectId]);
  const project = p.rows[0] as { id: number; name: string };

  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [id],
  );
  const fields = await db.query(
    "SELECT id, name FROM custom_fields WHERE project_id = $1::bigint ORDER BY position, id",
    [id],
  );
  const tasks = await db.query(
    `SELECT t.id, t.section_id, t.parent_task_id, t.name, t.description, u.name AS assignee,
       t.completed, t.start_on::text AS start_on, t.due_on::text AS due_on,
       t.progress, t.status, t.recurrence,
       (SELECT string_agg(c.body, E'\\n---\\n' ORDER BY c.id) FROM comments c WHERE c.task_id = t.id) AS comments,
       (SELECT string_agg(v.field_id || '=' || COALESCE(v.value_text, v.value_number::text, ''), ';' ORDER BY v.field_id)
        FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id WHERE v.task_id = t.id) AS custom_values
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1::bigint AND t.deleted_at IS NULL ORDER BY t.position, t.id`,
    [id],
  );

  const safeName = project.name.replace(/[^\w\-ぁ-んァ-ン一-龯ー]+/g, "_").slice(0, 80) || "project";
  if (format === "json") {
    const body = JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        project,
        sections: sections.rows,
        custom_fields: fields.rows,
        tasks: tasks.rows,
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.json`)}`,
      },
    });
  }

  const fieldNames = (fields.rows as { id: number; name: string }[]).map((f) => f.name);
  const header = ["セクション", "種別", "名前", "完了", "担当者", "開始日", "期日", "進捗", "Status", "繰返し", "コメント", ...fieldNames];
  const sectionName = new Map((sections.rows as { id: number; name: string }[]).map((s) => [s.id, s.name]));
  const valueByField = new Map(
    (fields.rows as { id: number }[]).map((f, i) => [f.id, i] as const),
  );
  const rows: unknown[][] = [header];
  for (const t of tasks.rows as {
    section_id: number | null;
    parent_task_id: number | null;
    name: string;
    description: string;
    assignee: string | null;
    completed: boolean;
    start_on: string | null;
    due_on: string | null;
    progress: number;
    status: string;
    recurrence: string;
    comments: string | null;
    custom_values: string | null;
  }[]) {
    const customs = new Array(fieldNames.length).fill("");
    for (const pair of (t.custom_values ?? "").split(";").filter(Boolean)) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const idx = valueByField.get(Number(pair.slice(0, eq)));
      if (idx !== undefined) customs[idx] = pair.slice(eq + 1);
    }
    rows.push([
        t.section_id === null ? "" : (sectionName.get(t.section_id) ?? ""),
        t.parent_task_id === null ? "タスク" : "サブタスク",
        t.name,
        t.completed ? "完了" : "未完了",
        t.assignee ?? "",
        t.start_on ?? "",
        t.due_on ?? "",
        t.progress,
        t.status,
        t.recurrence === "none" ? "" : t.recurrence,
        t.comments ?? "",
        ...customs,
    ]);
  }
  return csvResponse(`${safeName}.csv`, toCsv(rows));
});
