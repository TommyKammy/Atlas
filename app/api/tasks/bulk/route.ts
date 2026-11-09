import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { getTaskProjectIds, requireProjectPermission, requireWorkspaceAdmin } from "@/lib/api-project-auth";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { runAutomations } from "@/lib/automation-runner";
import { emitTaskEvent } from "@/lib/domain/events";
import { insertNextOccurrence, type RecurringTask } from "@/lib/services/task-write";

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
    const updatedIds = await withTransaction(async (q) => {
      const r = await q.query(
        `UPDATE tasks SET completed = $1, completed_at = ${done ? "now()" : "NULL"}, updated_at = now()
         WHERE id = ANY($2::bigint[]) RETURNING id`,
        [done, ids],
      );
      const changed = r.rows.map((row) => Number(row.id));
      if (changed.length > 0) {
        await q.query(
          `INSERT INTO task_events (task_id, actor_id, kind, summary)
           SELECT id, $2::bigint, $3, $4 FROM tasks WHERE id = ANY($1::bigint[])`,
          [
            changed,
            uid,
            done ? "completed" : "reopened",
            done ? "タスクを完了しました" : "タスクを未完了に戻しました",
          ],
        );
      }
      if (done && changed.length > 0) {
        const rec = await q.query(
          `SELECT id, project_id, section_id, name, description, assignee_id,
             start_on::text AS start_on, due_on::text AS due_on, status, recurrence,
             is_milestone
           FROM tasks WHERE id = ANY($1::bigint[]) AND recurrence <> 'none' AND parent_task_id IS NULL`,
          [changed],
        );
        for (const task of rec.rows as RecurringTask[]) {
          await insertNextOccurrence(q, task);
        }
      }
      return changed;
    });
    updated = updatedIds.length;
    if (done) {
      for (const id of updatedIds) {
        const projectId = projects.get(id) ?? null;
        if (projectId !== null) {
          await runAutomations(projectId, id, "task_completed").catch(() => undefined);
          await emitTaskEvent({
            projectId,
            taskId: id,
            actorId: uid,
            type: "task.completed",
            data: { bulk: true, previous: false, next: true },
          }).catch(() => undefined);
        }
      }
    } else {
      for (const id of updatedIds) {
        const projectId = projects.get(id) ?? null;
        if (projectId !== null) {
          await emitTaskEvent({
            projectId,
            taskId: id,
            actorId: uid,
            type: "task.reopened",
            data: { bulk: true, previous: true, next: false },
          }).catch(() => undefined);
        }
      }
    }
  } else if (op === "move") {
    const r = await db.query(
      `UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = ANY($2::bigint[])`,
      [body.section_id ?? null, ids],
    );
    updated = r.rowCount ?? 0;
    for (const id of ids) {
      const projectId = projects.get(id) ?? null;
      if (projectId !== null) {
        await emitTaskEvent({
          projectId,
          taskId: id,
          actorId: uid,
          type: "task.section_changed",
          data: { bulk: true, section_id: body.section_id ?? null },
        }).catch(() => undefined);
      }
    }
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
    for (const id of ids) {
      const projectId = projects.get(id) ?? null;
      if (projectId !== null) {
        await emitTaskEvent({
          projectId,
          taskId: id,
          actorId: uid,
          type: "task.assigned",
          data: { bulk: true, assignee_id: body.assignee_id ?? null },
        }).catch(() => undefined);
      }
    }
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
  for (const projectId of projectIds) await notifyProject(projectId);
  await audit(uid, "task.bulk", { entity: "task", summary: `${String(op)}:${updated}` });
  // Deleted tasks have no rows left; notify their sections' projects best-effort is skipped.
  return NextResponse.json({ updated });
});
