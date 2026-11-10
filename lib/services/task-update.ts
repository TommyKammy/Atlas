import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { notifyProject, notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { badRequest, conflict } from "@/lib/api/errors";
import { getTaskProjectContext, getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";
import { runAutomations } from "@/lib/automation-runner";
import { emitTaskEvent } from "@/lib/domain/events";
import { validateRichTextDoc } from "@/lib/rich-text-validation";
import { normalizeMentionLabels } from "@/lib/mentions";
import { docToMarkdown } from "@/lib/rich-text-markdown";
import { validateTaskPatch } from "@/lib/services/task-write";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS, type TaskCompletionRow } from "@/lib/services/task-completion";
import { mutateTaskTrees } from "@/lib/services/task-tree-mutation";
import { assertOrdinaryTaskMutation } from "./task-approval-guard";

type TaskHandlerContext = { taskId: number; uid: number; projectId: number | null };
type TaskBeforePatch = {
  name: string;
  completed: boolean;
  assignee_id: number | null;
  status: string;
  section_id: number | null;
  start_on: string | null;
  due_on: string | null;
  is_milestone: boolean;
};

const PATCHABLE = new Set([
  "name",
  "description",
  "description_doc",
  "assignee_id",
  "completed",
  "start_on",
  "due_on",
  "progress",
  "status",
  "section_id",
  "position",
  "project_id",
  "parent_task_id",
  "recurrence",
  "is_milestone",
]);

export async function updateTask(
  req: Request,
  { taskId, uid, projectId: currentProjectId }: TaskHandlerContext,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const currentRow = await db.query(
    `SELECT project_id, start_on::text AS start_on, due_on::text AS due_on
     FROM tasks WHERE id = $1::bigint`,
    [taskId],
  );
  const current = currentRow.rows[0];
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const primaryProjectId = current.project_id as number | null;

  // The project that grants permission to edit shared fields may be a
  // secondary home. Primary layout changes require permission at the actual
  // source, even when the requested destination granted the original access.
  const rawProject = body.project_id;
  const editsPrimaryLayout = rawProject !== undefined ||
    "position" in body || "parent_task_id" in body || body.is_milestone === true;
  if (editsPrimaryLayout) {
    const sourceProjectId = primaryProjectId ?? await getTaskProjectId(taskId);
    if (sourceProjectId !== null && sourceProjectId !== currentProjectId) {
      const sourceAuth = await requireProjectPermission(req, sourceProjectId, "edit");
      if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
    }
  }
  const defaultTargetProjectId = editsPrimaryLayout ? primaryProjectId ?? currentProjectId : currentProjectId;
  const targetProjectId = rawProject === undefined ? defaultTargetProjectId : Number(rawProject);
  if (targetProjectId === null || !Number.isInteger(targetProjectId) || targetProjectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  if (rawProject !== undefined && targetProjectId !== currentProjectId) {
    const targetAuth = await requireProjectPermission(req, targetProjectId, "edit");
    if (!targetAuth.ok) return NextResponse.json({ error: targetAuth.error }, { status: targetAuth.status });
  }
  const movesPrimary = rawProject !== undefined && targetProjectId !== primaryProjectId;
  if (movesPrimary) {
    if (!("section_id" in body)) body.section_id = null;
    if (!("parent_task_id" in body)) body.parent_task_id = null;
  }
  let sectionProjectId = targetProjectId;
  if ("section_id" in body) {
    const rawSection = body.section_id;
    if (rawSection === null || rawSection === "") {
      body.section_id = null;
    } else {
      const sectionId = Number(rawSection);
      if (!Number.isInteger(sectionId) || sectionId <= 0) {
        return NextResponse.json({ error: "invalid section_id" }, { status: 400 });
      }
      const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
      if (section.rowCount === 0 || (rawProject !== undefined && section.rows[0].project_id !== targetProjectId)) {
        return NextResponse.json({ error: "section does not belong to project" }, { status: 400 });
      }
      sectionProjectId = section.rows[0].project_id as number;
      body.section_id = sectionId;
    }
    if (sectionProjectId !== currentProjectId && sectionProjectId !== targetProjectId) {
      const sectionAuth = await requireProjectPermission(req, sectionProjectId, "edit");
      if (!sectionAuth.ok) return NextResponse.json({ error: sectionAuth.error }, { status: sectionAuth.status });
    }
  }
  const changesSecondarySection = "section_id" in body && rawProject === undefined && sectionProjectId !== primaryProjectId;
  if ("parent_task_id" in body) {
    const rawParent = body.parent_task_id;
    if (rawParent === null || rawParent === "") {
      body.parent_task_id = null;
    } else {
      const parentId = Number(rawParent);
      if (!Number.isInteger(parentId) || parentId <= 0 || parentId === taskId) {
        return NextResponse.json({ error: "invalid parent_task_id" }, { status: 400 });
      }
      const parentProjectId = await getTaskProjectId(parentId);
      if (parentProjectId !== targetProjectId) {
        return NextResponse.json({ error: "parent task is in another project" }, { status: 400 });
      }
      body.parent_task_id = parentId;
    }
  }
  if ("assignee_id" in body) {
    const rawAssignee = body.assignee_id;
    if (rawAssignee === null || rawAssignee === "") {
      body.assignee_id = null;
    } else {
      const assigneeId = Number(rawAssignee);
      if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
        return NextResponse.json({ error: "invalid assignee_id" }, { status: 400 });
      }
      const user = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [assigneeId]);
      if (user.rowCount === 0) {
        return NextResponse.json({ error: "assignee not found" }, { status: 400 });
      }
      body.assignee_id = assigneeId;
    }
  }
  if ("project_id" in body) body.project_id = targetProjectId;

  if ("description_doc" in body) {
    if (body.description_doc === null) {
      body.description = "";
    } else {
      const parsed = validateRichTextDoc(body.description_doc, {
        maxBytes: 256_000,
        maxChars: 50_000,
        maxNodes: 4_000,
        maxDepth: 20,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: `invalid description_doc: ${parsed.error}` }, { status: 400 });
      }
      const normalized = await normalizeMentionLabels(parsed.doc, targetProjectId);
      body.description_doc = normalized;
      body.description = docToMarkdown(normalized);
    }
  } else if ("description" in body) {
    // Legacy markdown edits invalidate a stale rich-text document.
    body.description_doc = null;
  }

  const validated = validateTaskPatch(body, {
    start_on: (current.start_on as string | null) ?? null,
    due_on: (current.due_on as string | null) ?? null,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  Object.assign(body, validated.values);

  // Milestones are top-level tasks. Keep the two fields consistent whichever
  // one the caller sends first.
  if (body.is_milestone === true) {
    body.parent_task_id = null;
  } else if ("parent_task_id" in body && body.parent_task_id !== null) {
    body.is_milestone = false;
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "section_id" && changesSecondarySection) continue;
    values.push(v === "" && k !== "description" ? null : v);
    sets.push(`${k} = $${values.length}`);
  }
  if (typeof body.completed === "boolean") {
    sets.push(body.completed ? "completed_at = CASE WHEN completed THEN completed_at ELSE now() END" : "completed_at = NULL");
  }
  if (sets.length === 0 && !changesSecondarySection) {
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });
  }
  const expected = body.expected_updated_at;
  const conflictResponse = async () => {
    const cur = await db.query("SELECT project_id, updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (cur.rows[0].project_id !== primaryProjectId) {
      return NextResponse.json({ error: "task primary project changed" }, { status: 409 });
    }
    const snap = await db.query(
      `SELECT t.name, t.completed, t.assignee_id, u.name AS assignee_name,
         t.start_on::text AS start_on, t.due_on::text AS due_on,
         t.progress, t.status, t.description, t.section_id, t.is_milestone,
         t.updated_at::text AS updated_at
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1::bigint`,
      [taskId],
    );
    return NextResponse.json(
      { error: "conflict", updated_at: cur.rows[0].u, current: snap.rows[0] ?? null },
      { status: 409 },
    );
  };
  if (typeof expected === "string" && expected !== "") {
    const cur = await db.query("SELECT updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (cur.rows[0].u !== expected) return conflictResponse();
  }
  values.push(taskId);
  let where = `id = $${values.length}::bigint`;
  values.push(primaryProjectId);
  where += ` AND project_id IS NOT DISTINCT FROM $${values.length}::bigint`;
  if (typeof expected === "string" && expected !== "") {
    values.push(expected);
    where += ` AND updated_at = $${values.length}::timestamptz`;
  }
  const nextSection = body.section_id as number | null | undefined;
  const result = await withTransaction(async (q) => {
    if (typeof body.parent_task_id === "number") {
      // Parent changes may race with reciprocal changes to other tasks.
      await q.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas:task-parents', 0))");
      const cycle = await q.query(
        `WITH RECURSIVE ancestors(id) AS (
           SELECT $2::bigint
           UNION
           SELECT t.parent_task_id FROM tasks t JOIN ancestors a ON a.id = t.id
           WHERE t.parent_task_id IS NOT NULL
         ) SELECT 1 FROM ancestors WHERE id = $1::bigint LIMIT 1`,
        [taskId, body.parent_task_id],
      );
      if ((cycle.rowCount ?? 0) > 0) throw badRequest("parent task cycle");
    }
    const before = await q.query<TaskBeforePatch>(
      `SELECT name, completed, assignee_id, status, section_id, start_on::text AS start_on,
         due_on::text AS due_on, is_milestone
       FROM tasks WHERE id = $1::bigint AND project_id IS NOT DISTINCT FROM $2::bigint FOR UPDATE`,
      [taskId, primaryProjectId],
    );
    const previousTask = before.rows[0];
    if (!previousTask) return null;
    await assertOrdinaryTaskMutation(q, [taskId], body);
    const updated = await q.query<TaskCompletionRow>(
      `UPDATE tasks SET ${[...sets, "updated_at = now()"].join(", ")}
       WHERE ${where} RETURNING ${TASK_COMPLETION_COLUMNS}`,
      values,
    );
    const task = updated.rows[0];
    if (!task) return null;
    if (!editsPrimaryLayout && currentProjectId !== null && currentProjectId !== primaryProjectId) {
      const context = await getTaskProjectContext(taskId, q);
      if (!context?.projectIds.includes(currentProjectId)) throw conflict("task membership changed");
    }
    let previousSection = previousTask.section_id;
    if (changesSecondarySection) {
      const membership = await q.query(
        `SELECT section_id FROM task_project_memberships
         WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE`,
        [taskId, sectionProjectId],
      );
      if (membership.rowCount === 0) throw badRequest("section project is not a task membership");
      previousSection = membership.rows[0].section_id as number | null;
      await q.query(
        `UPDATE task_project_memberships SET section_id = $3::bigint
         WHERE task_id = $1::bigint AND project_id = $2::bigint`,
        [taskId, sectionProjectId, nextSection],
      );
    }
    if (movesPrimary) {
      // A destination that was a secondary home is now represented by tasks.project_id.
      await q.query(
        "DELETE FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, targetProjectId],
      );
    }
    if (movesPrimary || (nextSection !== undefined && nextSection !== previousSection)) {
      const projects = movesPrimary ? [primaryProjectId, targetProjectId] : [sectionProjectId];
      await q.query(
        "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = ANY($2::bigint[])",
        [taskId, projects],
      );
    }
    if (task.completed !== previousTask.completed) {
      await recordTaskCompletion(q, { task, projectId: targetProjectId, actorId: uid });
    }
    if (task.assignee_id !== previousTask.assignee_id) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.assigned",
        data: { previous_assignee_id: previousTask.assignee_id, assignee_id: task.assignee_id },
      }, q);
    }
    if (task.due_on !== previousTask.due_on) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.due_changed",
        data: { previous_due_on: previousTask.due_on, due_on: task.due_on },
      }, q);
    }
    if (nextSection !== undefined && nextSection !== previousSection) {
      await emitTaskEvent({
        projectId: sectionProjectId,
        taskId,
        actorId: uid,
        type: "task.section_changed",
        data: { previous_section_id: previousSection, section_id: nextSection },
      }, q);
    }
    if (task.is_milestone !== previousTask.is_milestone) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.milestone_changed",
        data: { previous: previousTask.is_milestone, is_milestone: task.is_milestone },
      }, q);
    }
    if (task.status !== previousTask.status) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.status_changed",
        data: { previous_status: previousTask.status, status: task.status },
      }, q);
    }
    if (movesPrimary) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.added_to_project",
        data: { previous_project_id: primaryProjectId, project_id: targetProjectId },
      }, q);
    }
    return { previousTask };
  });
  if (result === null) return conflictResponse();
  const log = (kind: string, summary: string) =>
    logEvent(taskId, uid, kind, summary).catch(() => undefined);
  const b = body as Record<string, unknown>;
  const prev = result.previousTask;
  if (prev) {
    if ("assignee_id" in b) {
      const next = b.assignee_id === "" || b.assignee_id === null ? null : Number(b.assignee_id);
      if (next !== prev.assignee_id) {
        let who = "担当者を外しました";
        if (next !== null) {
          const u = await db.query("SELECT name FROM users WHERE id = $1", [next]);
          who = `担当者を${u.rows[0]?.name ?? `ID:${next}`}に変更しました`;
        }
        await log("assignee_changed", who);
      }
    }
    if ("start_on" in b) {
      const next = b.start_on === "" || b.start_on === null ? null : String(b.start_on);
      if (next !== prev.start_on) {
        await log("start_changed", next ? `開始日を${next}に設定しました` : "開始日をクリアしました");
      }
    }
    if ("due_on" in b) {
      const next = b.due_on === "" || b.due_on === null ? null : String(b.due_on);
      if (next !== prev.due_on) {
        await log("due_changed", next ? `期日を${next}に設定しました` : "期日をクリアしました");
      }
    }
    if (typeof b.name === "string" && b.name.trim() !== "" && b.name.trim() !== prev.name) {
      await log("renamed", "タスク名を変更しました");
    }
    if (typeof b.is_milestone === "boolean" && b.is_milestone !== prev.is_milestone) {
      await log(
        "type_changed",
        b.is_milestone ? "マイルストーンに変換しました" : "タスクに変換しました",
      );
    }
    if (b.completed === true && prev.completed === false) {
      await runAutomations(targetProjectId, taskId, "task_completed").catch(() => undefined);
    }
    if (typeof b.status === "string" && b.status !== prev.status) {
      await runAutomations(targetProjectId, taskId, "status_changed").catch(() => undefined);
    }
  }
  await notifyTask(taskId);
  if (changesSecondarySection) await notifyProject(sectionProjectId);
  await audit(uid, "task.update", { entity: "task", entityId: taskId, summary: Object.keys(b).join(",") });
  return NextResponse.json({ id: taskId });
}

export async function deleteTask(
  req: Request,
  { taskId, uid, projectId }: TaskHandlerContext,
): Promise<Response> {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const deleted = await mutateTaskTrees(new Map([[taskId, projectId]]), force ? "purge" : "trash");
  if (deleted === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(taskId);
  await audit(uid, force ? "task.purge" : "task.delete", { entity: "task", entityId: taskId, projectId: projectId ?? undefined });
  if (!force) await logEvent(taskId, uid, "deleted", "タスクをゴミ箱に入れました").catch(() => undefined);
  return NextResponse.json({ deleted: taskId });
}
