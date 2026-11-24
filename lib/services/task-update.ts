import { getTaskProjectContext, getTaskProjectId } from "@/lib/api-project-auth";
import { audit, auditScope } from "@/lib/audit";
import { runAutomations } from "@/lib/automation-runner";
import { logEvent } from "@/lib/data";
import { db, withTransaction } from "@/lib/db";
import { emitTaskEvent } from "@/lib/domain/events";
import { normalizeMentionLabels } from "@/lib/mentions";
import { notifyProject, notifyTask } from "@/lib/notify";
import { docToMarkdown } from "@/lib/rich-text-markdown";
import { validateRichTextDoc } from "@/lib/rich-text-validation";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS, type TaskCompletionRow } from "@/lib/services/task-completion";
import { mutateTaskTrees } from "@/lib/services/task-tree-mutation";
import { validateTaskPatch } from "@/lib/services/task-write";
import { assertOrdinaryTaskMutation } from "./task-approval-guard";
import { lockTaskOrder, parseTaskPlacement, resolveTaskPosition } from "./task-placement";
import { TaskMutationFailure } from "./task-mutation-failure";

type TaskMutationContext = { taskId: number; uid: number; projectId: number | null };
type TaskUpdateContext = TaskMutationContext & {
  /** The caller must authorize every additional source/destination project. */
  authorizeProject: (projectId: number) => Promise<void>;
};
type TaskBeforePatch = {
  name: string;
  completed: boolean;
  assignee_id: number | null;
  status: string;
  section_id: number | null;
  start_on: string | null;
  due_on: string | null;
  is_milestone: boolean;
  parent_task_id: number | null;
  deleted_at: string | null;
};

/** Current task fields and stamp for a compare-and-set conflict response. */
export async function taskConflictSnapshot(taskId: number): Promise<{
  updated_at: string | null;
  current: Record<string, unknown> | null;
}> {
  const snap = await db.query(
    `SELECT t.name, t.completed, t.assignee_id, u.name AS assignee_name,
       t.start_on::text AS start_on, t.due_on::text AS due_on,
       t.progress, t.status, t.description, t.section_id, t.is_milestone,
       t.updated_at::text AS updated_at
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.id = $1::bigint`,
    [taskId],
  );
  const current = snap.rows[0] ?? null;
  return {
    updated_at: typeof current?.updated_at === "string" ? current.updated_at : null,
    current,
  };
}

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

/**
 * Input keys that control the write rather than describe a change. The
 * optimistic-lock stamp authorizes the write; it is not a changed field.
 */
const AUDIT_CONTROL_KEYS = new Set(["expected_updated_at"]);

/** Audit summary naming only the fields the patch actually changes. */
export function taskAuditSummary(body: Record<string, unknown>): string {
  return Object.keys(body)
    .filter((key) => !AUDIT_CONTROL_KEYS.has(key))
    .join(",");
}

export async function updateTask(
  input: Record<string, unknown>,
  { taskId, uid, projectId: currentProjectId, authorizeProject }: TaskUpdateContext,
): Promise<{ id: number; updated_at: string }> {
  const body = { ...input };
  const placement = "placement" in body ? parseTaskPlacement(body.placement, taskId) : null;
  if (placement) {
    if (Object.keys(body).some(key => !["placement", "section_id", "assignee_id", "status", "expected_updated_at"].includes(key))) {
      throw new TaskMutationFailure("invalid", "incompatible task placement fields");
    }
    if (placement.project_id !== currentProjectId) await authorizeProject(placement.project_id);
  }

  const currentRow = await db.query(
    `SELECT project_id, start_on::text AS start_on, due_on::text AS due_on
     FROM tasks WHERE id = $1::bigint`,
    [taskId],
  );
  const current = currentRow.rows[0];
  if (!current) throw new TaskMutationFailure("missing", "not found");
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
      await authorizeProject(sourceProjectId);
    }
  }
  const defaultTargetProjectId = editsPrimaryLayout ? primaryProjectId ?? currentProjectId : currentProjectId;
  const targetProjectId = placement?.project_id ?? (rawProject === undefined ? defaultTargetProjectId : Number(rawProject));
  if (targetProjectId === null || !Number.isInteger(targetProjectId) || targetProjectId <= 0) {
    throw new TaskMutationFailure("invalid", "project_id is required");
  }
  if (rawProject !== undefined && targetProjectId !== currentProjectId) {
    await authorizeProject(targetProjectId);
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
        throw new TaskMutationFailure("invalid", "invalid section_id");
      }
      const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
      if (section.rowCount === 0 || ((placement || rawProject !== undefined) && section.rows[0].project_id !== targetProjectId)) {
        throw new TaskMutationFailure("invalid", "section does not belong to project");
      }
      sectionProjectId = section.rows[0].project_id as number;
      body.section_id = sectionId;
    }
    if (sectionProjectId !== currentProjectId && sectionProjectId !== targetProjectId) {
      await authorizeProject(sectionProjectId);
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
        throw new TaskMutationFailure("invalid", "invalid parent_task_id");
      }
      const parentProjectId = await getTaskProjectId(parentId);
      if (parentProjectId !== targetProjectId) {
        throw new TaskMutationFailure("invalid", "parent task is in another project");
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
        throw new TaskMutationFailure("invalid", "invalid assignee_id");
      }
      const user = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [assigneeId]);
      if (user.rowCount === 0) {
        throw new TaskMutationFailure("invalid", "assignee not found");
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
        throw new TaskMutationFailure("invalid", `invalid description_doc: ${parsed.error}`);
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
    throw new TaskMutationFailure("invalid", validated.error);
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
  if (sets.length === 0 && !changesSecondarySection && !placement) {
    throw new TaskMutationFailure("invalid", "no patchable fields");
  }
  const expected = body.expected_updated_at;
  const rejectConflict = async (): Promise<never> => {
    const cur = await db.query("SELECT project_id, updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) throw new TaskMutationFailure("missing", "not found");
    if (cur.rows[0].project_id !== primaryProjectId) {
      throw new TaskMutationFailure("conflict", "task primary project changed");
    }
    const snapshot = await taskConflictSnapshot(taskId);
    throw new TaskMutationFailure("conflict", "conflict", {
      updated_at: cur.rows[0].u, current: snapshot.current,
    });
  };
  if (typeof expected === "string" && expected !== "") {
    const cur = await db.query("SELECT updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) throw new TaskMutationFailure("missing", "not found");
    if (cur.rows[0].u !== expected) return rejectConflict();
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
    if (placement || "position" in body) await lockTaskOrder(q, targetProjectId);
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
      if ((cycle.rowCount ?? 0) > 0) throw new TaskMutationFailure("invalid", "parent task cycle", { code: "bad_request" });
    }
    const before = await q.query<TaskBeforePatch>(
      `SELECT name, completed, assignee_id, status, section_id, start_on::text AS start_on,
         due_on::text AS due_on, is_milestone, parent_task_id, deleted_at
       FROM tasks WHERE id = $1::bigint AND project_id IS NOT DISTINCT FROM $2::bigint FOR UPDATE`,
      [taskId, primaryProjectId],
    );
    const previousTask = before.rows[0];
    if (!previousTask) return null;
    if (placement && (previousTask.parent_task_id !== null || previousTask.deleted_at !== null)) {
      throw new TaskMutationFailure("conflict", "task is no longer in this view");
    }
    await assertOrdinaryTaskMutation(q, [taskId], body);
    const updated = await q.query<TaskCompletionRow & { updated_at: string }>(
      `UPDATE tasks SET ${[...sets, "updated_at = now()"].join(", ")}
       WHERE ${where} RETURNING ${TASK_COMPLETION_COLUMNS}, updated_at::text AS updated_at`,
      values,
    );
    const task = updated.rows[0];
    if (!task) return null;
    if (!editsPrimaryLayout && currentProjectId !== null && currentProjectId !== primaryProjectId) {
      const context = await getTaskProjectContext(taskId, q);
      if (!context?.projectIds.includes(currentProjectId)) throw new TaskMutationFailure("conflict", "task membership changed", { code: "conflict" });
    }
    let previousSection = previousTask.section_id;
    if (changesSecondarySection) {
      const membership = await q.query(
        `SELECT section_id FROM task_project_memberships
         WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE`,
        [taskId, sectionProjectId],
      );
      if (membership.rowCount === 0) throw new TaskMutationFailure("invalid", "section project is not a task membership", { code: "bad_request" });
      previousSection = membership.rows[0].section_id as number | null;
      await q.query(
        `UPDATE task_project_memberships SET section_id = $3::bigint
         WHERE task_id = $1::bigint AND project_id = $2::bigint`,
        [taskId, sectionProjectId, nextSection],
      );
    }
    if (placement) {
      const position = await resolveTaskPosition(q, taskId, placement, nextSection);
      if (primaryProjectId === targetProjectId) {
        // Detach inherited secondary ranks before moving the primary placement.
        await q.query(
          `UPDATE task_project_memberships m SET position = t.position FROM tasks t
           WHERE t.id = $1 AND m.task_id = t.id AND m.project_id <> $2 AND m.position IS NULL`,
          [taskId, targetProjectId],
        );
        await q.query("UPDATE tasks SET position = $2 WHERE id = $1", [taskId, position]);
      } else {
        const membership = await q.query(
          "UPDATE task_project_memberships SET position = $3 WHERE task_id = $1 AND project_id = $2",
          [taskId, targetProjectId, position],
        );
        if (!membership.rowCount) throw new TaskMutationFailure("conflict", "task membership changed");
      }
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
    return { previousTask, updatedAt: task.updated_at };
  });
  if (result === null) return rejectConflict();
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
  if (changesSecondarySection || (placement && primaryProjectId !== targetProjectId)) await notifyProject(sectionProjectId);
  // audit() derives the project from tasks.project_id; projectless tasks (subtasks,
  // secondary-home only) need the project the edit was authorized in.
  await audit(uid, "task.update", {
    entity: "task",
    entityId: taskId,
    ...(primaryProjectId === null && !movesPrimary ? await auditScope(targetProjectId) : {}),
    summary: taskAuditSummary(b),
  });
  // Return the stamp produced by this UPDATE, not a later re-read. Synchronous
  // automations (set_status / set_assignee) may advance tasks.updated_at after
  // it commits; reporting that newer value would let a caller pass a stamp it
  // never observed and silently overwrite a concurrent client's write.
  return {
    id: taskId,
    updated_at: result.updatedAt,
  };
}

export async function deleteTask(
  { force }: { force: boolean },
  { taskId, uid, projectId }: TaskMutationContext,
): Promise<{ deleted: number }> {
  const deleted = await mutateTaskTrees(new Map([[taskId, projectId]]), force ? "purge" : "trash");
  if (deleted === 0) throw new TaskMutationFailure("missing", "not found");
  await notifyTask(taskId);
  await audit(uid, force ? "task.purge" : "task.delete", { entity: "task", entityId: taskId, ...(await auditScope(projectId)) });
  if (!force) await logEvent(taskId, uid, "deleted", "タスクをゴミ箱に入れました").catch(() => undefined);
  return { deleted: taskId };
}
