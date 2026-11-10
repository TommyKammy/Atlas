import { withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { logEvent } from "@/lib/repositories/tasks";
import { getProjectAccess } from "@/lib/repositories/projects";
import { canEditProject, canManageProject } from "@/lib/project-roles";
import { canEditCustomField, normalizeAccessLevel } from "@/lib/custom-fields";
import { normalizeFieldEditorIds } from "@/lib/field-access";
import { notifyProject } from "@/lib/notify";
import { emitTaskEvent } from "@/lib/domain/events";

type CopyContext = { taskId: number; uid: number; projectId: number | null };

function nextPositionSql(): string {
  return `COALESCE((SELECT MAX(position) FROM tasks
    WHERE project_id = $1::bigint AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
      AND COALESCE(parent_task_id,-1) = COALESCE($3::bigint,-1)), 0) + 1000`;
}

async function afterCreate(
  newId: number,
  taskId: number,
  uid: number,
  projectId: number,
  auditAction: string,
  eventSummary: string,
): Promise<void> {
  await logEvent(newId, uid, "created", eventSummary).catch(() => undefined);
  await audit(uid, auditAction, {
    entity: "task",
    entityId: newId,
    projectId,
    summary: `from ${taskId}`,
  });
  await notifyProject(projectId);
}

/** Duplicate one task (fields + custom-field values) into the same project/section. */
export async function duplicateTask({
  taskId,
  uid,
  projectId,
}: CopyContext): Promise<{ id: number }> {
  if (!projectId) throw badRequest("task has no project");
  const newId = await withTransaction(async (q) => {
    const source = await q.query(
      `SELECT project_id, section_id, parent_task_id, name, description, description_doc,
         assignee_id, start_on::text AS start_on, due_on::text AS due_on,
         progress, status, recurrence, is_milestone
       FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE`,
      [taskId],
    );
    const t = source.rows[0];
    if (!t) throw notFound();
    if (t.project_id !== projectId) throw conflict("task primary project changed");
    const access = await getProjectAccess(uid, projectId, q);
    if (!canEditProject(access.role)) throw forbidden("project edit access required");

    const inserted = await q.query(
      `INSERT INTO tasks (
         project_id, section_id, parent_task_id, name, description, description_doc,
         assignee_id, created_by, completed, start_on, due_on, progress, status, recurrence,
         is_milestone, position
       ) VALUES (
         $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
         $7::bigint, $8::bigint, FALSE, $9::date, $10::date, $11, $12, $13,
         $14, ${nextPositionSql()}
       ) RETURNING id`,
      [
        projectId,
        t.section_id,
        t.parent_task_id,
        t.name,
        t.description,
        t.description_doc == null ? null : JSON.stringify(t.description_doc),
        t.assignee_id,
        uid,
        t.start_on,
        t.due_on,
        t.progress ?? 0,
        t.status ?? "inbox",
        t.recurrence ?? "none",
        t.is_milestone === true,
      ],
    );
    const id = Number(inserted.rows[0].id);
    const fields = await q.query(
      `SELECT f.id, f.access_level, f.editor_ids
       FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
       WHERE v.task_id = $1::bigint AND f.project_id = $2::bigint AND f.deleted_at IS NULL
       ORDER BY f.id FOR SHARE OF f`,
      [taskId, projectId],
    );
    const editableFields = fields.rows.filter((field) => canEditCustomField(
      { access_level: normalizeAccessLevel(field.access_level), editor_ids: normalizeFieldEditorIds(field.editor_ids) },
      { viewerId: uid, canEdit: true, canAdmin: canManageProject(access.role) },
    )).map((field) => field.id);
    if (editableFields.length > 0) {
      await q.query(
        `INSERT INTO task_custom_values
           (task_id, field_id, value_text, value_number, value_date, value_json)
         SELECT $1::bigint, field_id, value_text, value_number, value_date, value_json
         FROM task_custom_values WHERE task_id = $2::bigint AND field_id = ANY($3::bigint[])`,
        [id, taskId, editableFields],
      );
    }
    await emitTaskEvent({
      projectId,
      taskId: id,
      actorId: uid,
      type: "task.created",
      data: { duplicated_from: taskId },
    }, q);
    return id;
  });
  await afterCreate(
    newId,
    taskId,
    uid,
    projectId,
    "task.duplicate",
    "タスクを複製しました",
  );
  return { id: newId };
}

/** Create a follow-up task in the same project/section. */
export async function createFollowUpTask({
  taskId,
  uid,
  projectId,
}: CopyContext): Promise<{ id: number }> {
  if (!projectId) throw badRequest("task has no project");
  const newId = await withTransaction(async (q) => {
    const source = await q.query(
      `SELECT project_id, section_id, parent_task_id, name, assignee_id
       FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE`,
      [taskId],
    );
    const t = source.rows[0];
    if (!t) throw notFound();
    if (t.project_id !== projectId) throw conflict("task primary project changed");
    const access = await getProjectAccess(uid, projectId, q);
    if (!canEditProject(access.role)) throw forbidden("project edit access required");

    const inserted = await q.query(
      `INSERT INTO tasks (
         project_id, section_id, parent_task_id, name, description, assignee_id,
         created_by, completed, progress, status, position
       ) VALUES (
         $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::bigint,
         $7::bigint, FALSE, 0, 'inbox',
         ${nextPositionSql()}
       ) RETURNING id`,
      [
        projectId,
        t.section_id,
        t.parent_task_id,
        `フォローアップ: ${t.name}`.slice(0, 255),
        `元タスク: ${t.name}`,
        t.assignee_id,
        uid,
      ],
    );
    const id = Number(inserted.rows[0].id);
    await emitTaskEvent({
      projectId,
      taskId: id,
      actorId: uid,
      type: "task.created",
      data: { follow_up_of: taskId },
    }, q);
    return id;
  });
  await afterCreate(
    newId,
    taskId,
    uid,
    projectId,
    "task.follow_up",
    "フォローアップタスクを作成しました",
  );
  return { id: newId };
}
