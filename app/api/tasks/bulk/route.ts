import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

// Bulk task operations (last-writer-wins; per-item conflict UI is out of scope).
// Body: { ids: number[], op: "complete"|"reopen"|"move"|"assign"|"delete",
//         section_id?: number|null, assignee_id?: number|null }
export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n)) : [];
  const op = body?.op;
  if (ids.length === 0 || ids.length > 200) {
    return NextResponse.json({ error: "ids (1-200) required" }, { status: 400 });
  }
  const idList = `(${ids.join(",")})`;
  const projectIds = new Set<number>();
  for (const taskId of ids) {
    const projectId = await getTaskProjectId(taskId);
    if (projectId !== null) projectIds.add(projectId);
  }
  for (const projectId of projectIds) {
    const auth = await requireProjectPermission(req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let updated = 0;
  if (op === "complete" || op === "reopen") {
    const done = op === "complete";
    const r = await db.query(
      `UPDATE tasks SET completed = $1, completed_at = ${done ? "now()" : "NULL"}, updated_at = now() WHERE id IN ${idList} RETURNING id`,
      [done],
    );
    updated = r.rowCount ?? 0;
    for (const row of r.rows) {
      await logEvent(row.id, uid, done ? "completed" : "reopened", done ? "タスクを完了しました" : "タスクを未完了に戻しました").catch(
        () => undefined,
      );
    }
    if (done) {
      const rec = await db.query(
        `SELECT id, project_id, section_id, name, description, assignee_id,
           start_on::text AS start_on, due_on::text AS due_on, status, recurrence
         FROM tasks WHERE id IN ${idList} AND recurrence <> 'none' AND parent_task_id IS NULL`,
      );
      for (const t of rec.rows as {
        id: number;
        project_id: number | null;
        section_id: number | null;
        name: string;
        description: string;
        assignee_id: number | null;
        start_on: string | null;
        due_on: string | null;
        status: string;
        recurrence: string;
      }[]) {
        const shift = (iso: string | null): string | null => {
          if (!iso) return null;
          const d = new Date(`${iso}T00:00:00Z`);
          if (t.recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
          else if (t.recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
          else {
            const day = d.getUTCDate();
            d.setUTCMonth(d.getUTCMonth() + 1);
            if (d.getUTCDate() < day) d.setUTCDate(0);
          }
          return d.toISOString().slice(0, 10);
        };
        await db.query(
          `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, assignee_id,
             start_on, due_on, progress, status, recurrence, position)
           VALUES ($1, $2, NULL, $3, $4, $5, $6::date, $7::date, 0, $8, $9,
             COALESCE((SELECT MAX(position) FROM tasks WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1) AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1) AND parent_task_id IS NULL), 0) + 1000)`,
          [
            t.project_id,
            t.section_id,
            t.name,
            t.description,
            t.assignee_id,
            shift(t.start_on),
            shift(t.due_on),
            t.status,
            t.recurrence,
          ],
        );
      }
    }
  } else if (op === "move") {
    const r = await db.query(`UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id IN ${idList}`, [
      body.section_id ?? null,
    ]);
    updated = r.rowCount ?? 0;
  } else if (op === "assign") {
    const r = await db.query(`UPDATE tasks SET assignee_id = $1::bigint, updated_at = now() WHERE id IN ${idList}`, [
      body.assignee_id ?? null,
    ]);
    updated = r.rowCount ?? 0;
    for (const row of (await db.query(`SELECT id FROM tasks WHERE id IN ${idList}`)).rows) {
      await logEvent(row.id, uid, "assignee_changed", "担当者を変更しました").catch(() => undefined);
    }
  } else if (op === "delete") {
    if (body.force === true) {
      const r = await db.query(`DELETE FROM tasks WHERE id IN ${idList}`);
      updated = r.rowCount ?? 0;
    } else {
      const r = await db.query(
        `WITH RECURSIVE sub AS (
           SELECT id FROM tasks WHERE id IN ${idList} AND deleted_at IS NULL
           UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
         ) UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
      );
      updated = r.rowCount ?? 0;
    }
  } else {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
  const pr = await db.query(
    `SELECT DISTINCT project_id FROM tasks WHERE id IN ${idList}`,
  ).catch(() => ({ rows: [] as { project_id: number }[] }));
  for (const row of pr.rows) await notifyProject(row.project_id);
  // Deleted tasks have no rows left; notify their sections' projects best-effort is skipped.
  return NextResponse.json({ updated });
}
