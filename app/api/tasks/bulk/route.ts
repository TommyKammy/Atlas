import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { notifyProject } from "@/lib/notify";
import { getTaskProjectIds, requireProjectPermission, requireWorkspaceAdmin } from "@/lib/api-project-auth";
import { nextOccurrence } from "@/lib/recurrence";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { runAutomations } from "@/lib/automation-runner";

// Bulk task operations (last-writer-wins; per-item conflict UI is out of scope).
// Body: { ids: number[], op: "complete"|"reopen"|"move"|"assign"|"delete",
//         section_id?: number|null, assignee_id?: number|null }
export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n)) : [];
  const op = body?.op;
  if (ids.length === 0 || ids.length > 200) {
    return NextResponse.json({ error: "ids (1-200) required" }, { status: 400 });
  }
  const projects = await getTaskProjectIds(ids);
  if (ids.some((id) => !projects.has(id))) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  const projectIds = new Set<number>();
  let hasProjectless = false;
  for (const id of ids) {
    const projectId = projects.get(id) ?? null;
    if (projectId === null) hasProjectless = true;
    else projectIds.add(projectId);
  }
  for (const projectId of projectIds) {
    const auth = await requireProjectPermission(req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (hasProjectless) {
    const admin = await requireWorkspaceAdmin(req);
    if (!admin.ok) return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  // A bulk move must keep every target task inside the destination section's project.
  if (op === "move" && body.section_id !== null && body.section_id !== undefined) {
    const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [body.section_id]);
    if (section.rowCount === 0) {
      return NextResponse.json({ error: "section not found" }, { status: 400 });
    }
    const sectionProjectId = Number(section.rows[0].project_id);
    if ([...projectIds].some((projectId) => projectId !== sectionProjectId)) {
      return NextResponse.json({ error: "section does not belong to task project" }, { status: 400 });
    }
  }
  let updated = 0;
  if (op === "complete" || op === "reopen") {
    const done = op === "complete";
    const r = await db.query(
      `UPDATE tasks SET completed = $1, completed_at = ${done ? "now()" : "NULL"}, updated_at = now()
       WHERE id = ANY($2::bigint[]) RETURNING id`,
      [done, ids],
    );
    updated = r.rowCount ?? 0;
    for (const row of r.rows) {
      await logEvent(row.id, uid, done ? "completed" : "reopened", done ? "タスクを完了しました" : "タスクを未完了に戻しました").catch(
        () => undefined,
      );
    }
    if (done) {
      for (const id of ids) {
        const projectId = projects.get(id) ?? null;
        if (projectId !== null) await runAutomations(projectId, id, "task_completed").catch(() => undefined);
      }
      const rec = await db.query(
        `SELECT id, project_id, section_id, name, description, assignee_id,
           start_on::text AS start_on, due_on::text AS due_on, status, recurrence
         FROM tasks WHERE id = ANY($1::bigint[]) AND recurrence <> 'none' AND parent_task_id IS NULL`,
        [ids],
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
            nextOccurrence(t.start_on, t.recurrence),
            nextOccurrence(t.due_on, t.recurrence),
            t.status,
            t.recurrence,
          ],
        );
      }
    }
  } else if (op === "move") {
    const r = await db.query(
      `UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = ANY($2::bigint[])`,
      [body.section_id ?? null, ids],
    );
    updated = r.rowCount ?? 0;
  } else if (op === "assign") {
    const r = await db.query(
      `UPDATE tasks SET assignee_id = $1::bigint, updated_at = now() WHERE id = ANY($2::bigint[])`,
      [body.assignee_id ?? null, ids],
    );
    updated = r.rowCount ?? 0;
    await db.query(
      `INSERT INTO task_events (task_id, actor_id, kind, summary)
       SELECT id, $2::bigint, 'assignee_changed', '担当者を変更しました' FROM tasks WHERE id = ANY($1::bigint[])`,
      [ids, uid],
    ).catch(() => undefined);
  } else if (op === "delete") {
    if (body.force === true) {
      const r = await db.query(`DELETE FROM tasks WHERE id = ANY($1::bigint[])`, [ids]);
      updated = r.rowCount ?? 0;
    } else {
      const r = await db.query(
        `WITH RECURSIVE sub AS (
           SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
           UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
         ) UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
        [ids],
      );
      updated = r.rowCount ?? 0;
    }
  } else {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
  const pr = await db.query(
    `SELECT DISTINCT project_id FROM tasks WHERE id = ANY($1::bigint[])`,
    [ids],
  ).catch(() => ({ rows: [] as { project_id: number }[] }));
  for (const row of pr.rows) await notifyProject(row.project_id);
  await audit(uid, "task.bulk", { entity: "task", summary: `${String(op)}:${updated}` });
  // Deleted tasks have no rows left; notify their sections' projects best-effort is skipped.
  return NextResponse.json({ updated });
});
