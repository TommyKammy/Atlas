import { badRequest } from "../api/errors";
import { getTaskProjectId } from "../api-project-auth";
import { db, withTransaction, type Queryable } from "../db";
import type { RichTextDoc } from "../rich-text-types";
import { emitTaskEvent } from "../domain/events";
import { notifyProject } from "../notify";
import { audit } from "../audit";
import { logEvent } from "../repositories/tasks";
import { runAutomations } from "../automation-runner";
import { requireProjectAccess, type Actor } from "./actor";

type NewTask = { projectId: number; sectionId: number | null; parentId: number | null; name: string; description?: string; descriptionDoc?: RichTextDoc; start: string | null; due: string | null; assigneeId: number | null; uid: number; isMilestone: boolean };
/** Shared by manual creation and approved AI proposals. Caller validates and authorizes. */
export async function insertTask(q: Queryable, t: NewTask): Promise<number> {
  const r = await q.query(`INSERT INTO tasks (project_id,section_id,parent_task_id,name,description,position,start_on,due_on,assignee_id,created_by,is_milestone,description_doc)
    VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position),0)+1000 FROM tasks WHERE COALESCE(project_id,-1)=COALESCE($1::bigint,-1)
      AND COALESCE(section_id,-1)=COALESCE($2::bigint,-1) AND COALESCE(parent_task_id,-1)=COALESCE($3::bigint,-1)),$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
  [t.projectId,t.sectionId,t.parentId,t.name,t.description ?? "",t.start,t.due,t.assigneeId,t.uid,t.isMilestone,t.descriptionDoc ? JSON.stringify(t.descriptionDoc) : null]);
  const id = Number(r.rows[0].id);
  await emitTaskEvent({ projectId: t.projectId, taskId: id, actorId: t.uid, type: "task.created",
    data: { name: t.name, section_id: t.sectionId, assignee_id: t.assigneeId, parent_task_id: t.parentId, is_milestone: t.isMilestone } }, q);
  return id;
}
export async function afterTaskCreated(projectId: number, taskId: number, uid: number, name: string) {
  await notifyProject(projectId);
  await audit(uid, "task.create", { entity: "task", entityId: taskId, projectId, summary: name });
  await logEvent(taskId, uid, "created", "タスクを作成しました").catch(() => undefined);
  await runAutomations(projectId, taskId, "task_created").catch(() => undefined);
}

/**
 * Create a task for an actor that need not come from an HTTP session.
 * Validation order and error messages mirror POST /api/tasks.
 */
export async function createTask(
  actor: Actor,
  input: unknown,
): Promise<{ id: number; updated_at: string }> {
  if (!input || typeof input !== "object") throw badRequest("invalid json");
  const body = input as Record<string, unknown>;
  const { project_id, section_id, name, parent_task_id, start_on, due_on, assignee_id } = body;
  let isMilestone = false;
  if (body.is_milestone !== undefined) {
    if (typeof body.is_milestone !== "boolean") throw badRequest("is_milestone must be a boolean");
    isMilestone = body.is_milestone;
  }
  if (typeof name !== "string" || name.trim() === "") throw badRequest("name is required");
  if (project_id === null || project_id === undefined || project_id === "") {
    throw badRequest("project_id is required");
  }
  const projectId = Number(project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) throw badRequest("invalid project_id");
  await requireProjectAccess(actor, projectId, "edit");

  let sectionId: number | null = null;
  if (section_id !== null && section_id !== undefined && section_id !== "") {
    sectionId = Number(section_id);
    const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
    if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
      throw badRequest("section does not belong to project");
    }
  }
  let parentId: number | null = null;
  if (parent_task_id !== null && parent_task_id !== undefined && parent_task_id !== "") {
    parentId = Number(parent_task_id);
    const parentProjectId = await getTaskProjectId(parentId);
    if (parentProjectId !== projectId) throw badRequest("parent task is in another project");
  }
  let assigneeId: number | null = null;
  if (assignee_id !== null && assignee_id !== undefined && assignee_id !== "") {
    assigneeId = Number(assignee_id);
    const user = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [assigneeId]);
    if (user.rowCount === 0) throw badRequest("assignee not found");
  }
  if (isMilestone && parentId !== null) throw badRequest("milestone cannot be a subtask");
  const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const start = dateOrNull(start_on);
  const due = dateOrNull(due_on);
  const id = await withTransaction(q => insertTask(q, {
    projectId, sectionId, parentId, name: name.trim(), start, due, assigneeId, uid: actor.uid, isMilestone,
  }));
  await afterTaskCreated(projectId, id, actor.uid, name);
  const stamp = await db.query("SELECT updated_at::text AS updated_at FROM tasks WHERE id = $1", [id]);
  return { id, updated_at: stamp.rows[0].updated_at as string };
}
