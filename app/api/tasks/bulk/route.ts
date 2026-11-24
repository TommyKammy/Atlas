import { NextResponse } from "next/server";
import { db, withTransaction, type Queryable } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { getTaskProjectIds, requireProjectPermission, requireWorkspaceAdmin } from "@/lib/api-project-auth";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { conflict } from "@/lib/api/errors";
import { runAutomations } from "@/lib/automation-runner";
import { emitTaskEvent } from "@/lib/domain/events";
import { insertTaskEvents } from "@/lib/repositories/tasks";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS, type TaskCompletionRow } from "@/lib/services/task-completion";
import { mutateTaskTrees } from "@/lib/services/task-tree-mutation";
import { assertOrdinaryTaskMutation } from "@/lib/services/task-approval-guard";

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
  const lockTaskProjects = async (q: Queryable) => {
    await q.query("SELECT id FROM tasks WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE", [ids]);
    const currentProjects = await getTaskProjectIds(ids, q);
    if (ids.some((id) => currentProjects.get(id) !== projects.get(id))) {
      throw conflict("task primary project changed");
    }
  };
  let updated = 0;
  if (op === "complete" || op === "reopen") {
    const done = op === "complete";
    const updatedIds = await withTransaction(async (q) => {
      await lockTaskProjects(q);
      await assertOrdinaryTaskMutation(q, ids, { completed: done });
      const r = await q.query<TaskCompletionRow>(
        `UPDATE tasks SET completed = $1, completed_at = ${done ? "now()" : "NULL"}, updated_at = now()
         WHERE id = ANY($2::bigint[]) AND completed IS DISTINCT FROM $1
         RETURNING ${TASK_COMPLETION_COLUMNS}`,
        [done, ids],
      );
      for (const task of r.rows) {
        await recordTaskCompletion(q, {
          task,
          projectId: projects.get(task.id) ?? null,
          actorId: uid,
          data: { bulk: true },
        });
      }
      return r.rows.map((row) => row.id);
    });
    updated = updatedIds.length;
    if (done) {
      for (const id of updatedIds) {
        const projectId = projects.get(id) ?? null;
        if (projectId !== null) {
          await runAutomations(projectId, id, "task_completed").catch(() => undefined);
        }
      }
    }
  } else if (op === "move") {
    updated = await withTransaction(async (q) => {
      await lockTaskProjects(q);
      const r = await q.query(
        "UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = ANY($2::bigint[])",
        [body.section_id ?? null, ids],
      );
      if (projectIds.size > 0) {
        await q.query("DELETE FROM task_timeline_rows WHERE task_id = ANY($1::bigint[])", [ids]);
      }
      for (const id of ids) {
        await emitTaskEvent({
          projectId: projects.get(id) ?? null,
          taskId: id,
          actorId: uid,
          type: "task.section_changed",
          data: { bulk: true, section_id: body.section_id ?? null },
        }, q);
      }
      return r.rowCount ?? 0;
    });
  } else if (op === "assign") {
    updated = await withTransaction(async (q) => {
      await lockTaskProjects(q);
      const r = await q.query(
        "UPDATE tasks SET assignee_id = $1::bigint, updated_at = now() WHERE id = ANY($2::bigint[])",
        [body.assignee_id ?? null, ids],
      );
      await insertTaskEvents(q, {
        taskIds: ids,
        actorId: uid,
        kind: "assignee_changed",
        summary: "担当者を変更しました",
      });
      for (const id of ids) {
        await emitTaskEvent({
          projectId: projects.get(id) ?? null,
          taskId: id,
          actorId: uid,
          type: "task.assigned",
          data: { bulk: true, assignee_id: body.assignee_id ?? null },
        }, q);
      }
      return r.rowCount ?? 0;
    });
  } else if (op === "delete") {
    updated = await mutateTaskTrees(projects, body.force === true ? "purge" : "trash");
  } else {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
  for (const projectId of projectIds) await notifyProject(projectId);
  await audit(uid, "task.bulk", { entity: "task", summary: `${String(op)}:${updated}` });
  // Deleted tasks have no rows left; notify their sections' projects best-effort is skipped.
  return NextResponse.json({ updated });
});
