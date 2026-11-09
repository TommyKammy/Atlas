import { createHmac } from "node:crypto";
import { db } from "../db";
import { getProjectAccess } from "../repositories/projects";
import { canEditProject } from "../project-roles";
import { logEvent } from "../repositories/tasks";
import { notifyProject, notifyTask } from "../notify";
import { audit } from "../audit";
import { canEditFieldValue } from "../field-access";
import { parseCommentPayload } from "../comment-payload";
import { replaceCommentMentions } from "../mentions";
import { todayISO } from "../dates";
import { shiftDate } from "../timeline-dnd";
import { emitDomainEvent, emitTaskEvent } from "../domain/events";
import { isProjectStatusColor } from "../project-status";
import { createProjectStatusUpdate } from "../repositories/home";
import type { DomainEventRow } from "../domain/events";

export type CapabilitySource = "automation" | "ai" | "manual";

export type CapabilityContext = {
  actorId: number;
  source: CapabilitySource;
  projectId: number;
  correlationId?: string | null;
  /** Parent event; actions emit child events with this causation id. */
  eventId?: number | null;
  chainDepth: number;
  ruleId?: number | null;
  event?: DomainEventRow | null;
};

export type CapabilityResult = {
  summary: string;
  data?: Record<string, unknown>;
};

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function taskProject(taskId: number): Promise<number> {
  const r = await db.query(
    "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL",
    [taskId],
  );
  const projectId = r.rows[0]?.project_id;
  if (!projectId) throw new Error("task not found or has no project");
  return Number(projectId);
}

async function assertEdit(ctx: CapabilityContext, projectId: number): Promise<void> {
  const access = await getProjectAccess(ctx.actorId, projectId);
  if (!canEditProject(access.role)) {
    throw new Error("rule owner does not have edit access to the project");
  }
}

async function childTaskEvent(
  ctx: CapabilityContext,
  taskId: number,
  type:
    | "task.completed"
    | "task.assigned"
    | "task.status_changed"
    | "task.due_changed"
    | "task.section_changed"
    | "task.custom_field_changed"
    | "task.created",
  data: Record<string, unknown>,
): Promise<void> {
  const projectId = await taskProject(taskId);
  await emitTaskEvent({
    projectId,
    taskId,
    actorId: ctx.actorId,
    type,
    data,
    causationId: ctx.eventId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  });
}

async function finishTaskAction(
  ctx: CapabilityContext,
  taskId: number,
  eventType:
    | "task.completed"
    | "task.assigned"
    | "task.status_changed"
    | "task.due_changed"
    | "task.section_changed"
    | "task.custom_field_changed",
  data: Record<string, unknown>,
  summary: string,
): Promise<CapabilityResult> {
  await logEvent(taskId, ctx.actorId, eventType.replace("task.", ""), summary).catch(() => undefined);
  await audit(ctx.actorId, `automation.${eventType}`, {
    entity: "task",
    entityId: taskId,
    summary: `[${ctx.source}] ${summary}`,
  });
  await notifyTask(taskId);
  await childTaskEvent(ctx, taskId, eventType, data);
  return { summary, data };
}

/**
 * Public capability gateway. Automation and the future AI assistant call
 * these commands instead of writing to domain tables directly.
 */
export async function executeCapability(
  capability: string,
  params: Record<string, unknown>,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  if (capability === "task.assign") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.assign requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    const userId = asNumber(params.user_id);
    if (userId !== null) {
      const user = await db.query(
        "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
        [userId],
      );
      if (user.rowCount === 0) throw new Error("assignee not found");
    }
    await db.query(
      "UPDATE tasks SET assignee_id = $1::bigint, updated_at = now() WHERE id = $2::bigint",
      [userId, taskId],
    );
    return finishTaskAction(ctx, taskId, "task.assigned", { assignee_id: userId }, "担当者を変更しました");
  }

  if (capability === "task.set_status") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.set_status requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    const status = asString(params.status);
    if (status === "") throw new Error("status is required");
    await db.query(
      "UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2::bigint",
      [status.slice(0, 64), taskId],
    );
    return finishTaskAction(ctx, taskId, "task.status_changed", { status }, `Statusを${status}に変更しました`);
  }

  if (capability === "task.set_due_date") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.set_due_date requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    let due = asString(params.due_on);
    if (due === "") {
      const offset = Number(params.offset_days);
      if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("valid due_on or offset_days is required");
    const current = await db.query(
      "SELECT start_on::text AS start_on FROM tasks WHERE id = $1::bigint",
      [taskId],
    );
    const start = current.rows[0]?.start_on as string | null | undefined;
    if (start && start > due) throw new Error("due date cannot be before start date");
    await db.query(
      "UPDATE tasks SET due_on = $1::date, updated_at = now() WHERE id = $2::bigint",
      [due, taskId],
    );
    return finishTaskAction(ctx, taskId, "task.due_changed", { due_on: due }, `期日を${due}に変更しました`);
  }

  if (capability === "task.move_section") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.move_section requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    const sectionId = asNumber(params.section_id);
    if (!sectionId) throw new Error("section_id is required");
    const section = await db.query(
      "SELECT project_id FROM sections WHERE id = $1::bigint",
      [sectionId],
    );
    if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
      throw new Error("section does not belong to the task project");
    }
    await db.query(
      "UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = $2::bigint",
      [sectionId, taskId],
    );
    return finishTaskAction(
      ctx,
      taskId,
      "task.section_changed",
      { section_id: sectionId },
      "セクションを変更しました",
    );
  }

  if (capability === "task.complete") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.complete requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    await db.query(
      "UPDATE tasks SET completed = TRUE, completed_at = now(), updated_at = now() WHERE id = $1::bigint",
      [taskId],
    );
    return finishTaskAction(ctx, taskId, "task.completed", { completed: true }, "タスクを完了しました");
  }

  if (capability === "task.add_comment") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.add_comment requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    const body = typeof params.body === "string" ? params.body : "";
    const parsed = await parseCommentPayload(projectId, { body });
    if (!parsed.ok) throw new Error(parsed.error);
    const inserted = await db.query(
      `INSERT INTO comments (task_id, author_id, body, body_doc)
       VALUES ($1::bigint, $2, $3, $4::jsonb) RETURNING id`,
      [taskId, ctx.actorId, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
    );
    const commentId = Number(inserted.rows[0].id);
    await replaceCommentMentions(commentId, parsed.mentionIds);
    await audit(ctx.actorId, "automation.comment.create", {
      entity: "comment",
      entityId: commentId,
      projectId,
      summary: parsed.text.slice(0, 120),
    });
    await notifyTask(taskId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "comment.created",
      data: { comment_id: commentId, body: parsed.text.slice(0, 500) },
      causationId: ctx.eventId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    });
    return { summary: "コメントを追加しました", data: { comment_id: commentId } };
  }

  if (capability === "task.create") {
    const projectId = asNumber(params.project_id ?? ctx.projectId);
    if (!projectId) throw new Error("task.create requires a project");
    await assertEdit(ctx, projectId);
    const name = asString(params.name);
    if (name === "") throw new Error("task name is required");
    let sectionId: number | null = null;
    if (params.section_id !== undefined && params.section_id !== null && params.section_id !== "") {
      sectionId = asNumber(params.section_id);
      if (!sectionId) throw new Error("invalid section_id");
      const section = await db.query(
        "SELECT project_id FROM sections WHERE id = $1::bigint",
        [sectionId],
      );
      if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
        throw new Error("section does not belong to the project");
      }
    }
    const assignee = asNumber(params.assignee_id);
    let due: string | null = null;
    const offset = Number(params.due_offset_days);
    if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
    const inserted = await db.query(
      `INSERT INTO tasks (
         project_id, section_id, parent_task_id, name, assignee_id, due_on, created_by,
         status, position
       ) VALUES ($1::bigint, $2::bigint, NULL, $3, $4::bigint, $5::date, $6::bigint,
         'inbox',
         COALESCE((SELECT MAX(position) FROM tasks
                   WHERE project_id = $1::bigint AND parent_task_id IS NULL), 0) + 1000)
       RETURNING id`,
      [projectId, sectionId, name.slice(0, 255), assignee, due, ctx.actorId],
    );
    const taskId = Number(inserted.rows[0].id);
    await logEvent(taskId, ctx.actorId, "created", "タスクをルールから作成しました").catch(() => undefined);
    await audit(ctx.actorId, "automation.task.create", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: name,
    });
    await notifyProject(projectId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "task.created",
      data: { created_by_rule: true },
      causationId: ctx.eventId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    });
    return { summary: "タスクを作成しました", data: { task_id: taskId } };
  }

  if (capability === "task.create_subtask") {
    const parentId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!parentId) throw new Error("task.create_subtask requires a parent task");
    const parent = await db.query(
      `SELECT project_id, section_id, parent_task_id FROM tasks
       WHERE id = $1::bigint AND deleted_at IS NULL`,
      [parentId],
    );
    if (parent.rowCount === 0) throw new Error("parent task not found");
    const projectId = Number(parent.rows[0].project_id);
    await assertEdit(ctx, projectId);
    const name = asString(params.name);
    if (name === "") throw new Error("subtask name is required");
    const assignee = asNumber(params.assignee_id);
    let due: string | null = null;
    const offset = Number(params.due_offset_days);
    if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
    const inserted = await db.query(
      `INSERT INTO tasks (
         project_id, section_id, parent_task_id, name, assignee_id, due_on, created_by,
         position
       ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5::bigint, $6::date, $7::bigint,
         COALESCE((SELECT MAX(position) FROM tasks WHERE parent_task_id = $3::bigint), 0) + 1000)
       RETURNING id`,
      [
        projectId,
        parent.rows[0].section_id ?? null,
        parentId,
        name.slice(0, 255),
        assignee,
        due,
        ctx.actorId,
      ],
    );
    const taskId = Number(inserted.rows[0].id);
    await logEvent(taskId, ctx.actorId, "created", "サブタスクをルールから作成しました").catch(() => undefined);
    await audit(ctx.actorId, "automation.task.create_subtask", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: name,
    });
    await notifyProject(projectId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "task.created",
      data: { parent_task_id: parentId, created_by_rule: true },
      causationId: ctx.eventId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    });
    return { summary: "サブタスクを作成しました", data: { task_id: taskId } };
  }

  if (capability === "task.set_custom_field") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    if (!taskId) throw new Error("task.set_custom_field requires a task");
    const projectId = await taskProject(taskId);
    await assertEdit(ctx, projectId);
    const fieldId = asNumber(params.field_id);
    if (!fieldId) throw new Error("field_id is required");
    const field = await db.query(
      `SELECT id, name, field_type, project_id, access_level, editor_ids
       FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL`,
      [fieldId],
    );
    if (field.rowCount === 0 || Number(field.rows[0].project_id) !== projectId) {
      throw new Error("custom field not found");
    }
    if (!(await canEditFieldValue(ctx.actorId, projectId, field.rows[0]))) {
      throw new Error("field access denied");
    }
    const value = params.value;
    const fieldType = String(field.rows[0].field_type);
    let text: string | null = null;
    let num: number | null = null;
    let date: string | null = null;
    let json: unknown = null;
    if (fieldType === "number") {
      num = value === null || value === "" ? null : Number(value);
      if (num !== null && !Number.isFinite(num)) throw new Error("numeric value required");
    } else if (fieldType === "date") {
      date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
      text = date;
    } else if (fieldType === "multi_select") {
      json = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(",").map((item) => item.trim()).filter(Boolean)
          : [];
      text = Array.isArray(json) ? json.join(", ") : null;
    } else if (fieldType === "people" || fieldType === "reference") {
      json = Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : [];
      text = Array.isArray(json) ? json.join(", ") : null;
    } else {
      text = value === null || value === undefined ? null : String(value);
    }
    const empty =
      text === null &&
      num === null &&
      date === null &&
      (json === null || (Array.isArray(json) && json.length === 0));
    if (empty) {
      await db.query(
        "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
        [taskId, fieldId],
      );
    } else {
      await db.query(
        `INSERT INTO task_custom_values
           (task_id, field_id, value_text, value_number, value_date, value_json)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6::jsonb)
         ON CONFLICT (task_id, field_id) DO UPDATE SET
           value_text = EXCLUDED.value_text,
           value_number = EXCLUDED.value_number,
           value_date = EXCLUDED.value_date,
           value_json = EXCLUDED.value_json`,
        [taskId, fieldId, text, num, date, json === null ? null : JSON.stringify(json)],
      );
    }
    return finishTaskAction(
      ctx,
      taskId,
      "task.custom_field_changed",
      { field_id: fieldId, field_name: field.rows[0].name, value },
      `カスタムフィールド「${field.rows[0].name}」を更新しました`,
    );
  }

  if (capability === "project.set_status") {
    const projectId = asNumber(params.project_id ?? ctx.projectId);
    if (!projectId) throw new Error("project.set_status requires a project");
    await assertEdit(ctx, projectId);
    const status = asString(params.status);
    if (status === "") throw new Error("status is required");
    const color = isProjectStatusColor(params.status_color) ? params.status_color : "none";
    await createProjectStatusUpdate(
      projectId,
      ctx.actorId,
      "ルールによりプロジェクトステータスを更新しました",
      status.slice(0, 80),
      color,
    );
    await audit(ctx.actorId, "automation.project.status", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: status,
    });
    await notifyProject(projectId);
    const workspace = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
      projectId,
    ]);
    if (workspace.rows[0]?.workspace_id) {
      await emitDomainEvent({
        workspaceId: Number(workspace.rows[0].workspace_id),
        projectId,
        actorId: ctx.actorId,
        type: "project.status_changed",
        subjectType: "project",
        subjectId: projectId,
        data: { status, status_color: color },
        causationId: ctx.eventId ?? null,
        chainDepth: ctx.chainDepth + 1,
        correlationId: ctx.correlationId ?? null,
      });
    }
    return { summary: `プロジェクトステータスを${status}に変更しました`, data: { status } };
  }

  if (capability === "task.add_to_project") {
    const taskId = asNumber(params.task_id ?? ctx.event?.subject_id);
    const targetProjectId = asNumber(params.project_id);
    if (!taskId || !targetProjectId) throw new Error("task.add_to_project requires task and project");
    const sourceProjectId = await taskProject(taskId);
    await assertEdit(ctx, sourceProjectId);
    await assertEdit(ctx, targetProjectId);
    const primary = await db.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [taskId]);
    if (Number(primary.rows[0]?.project_id) === targetProjectId) {
      throw new Error("task already belongs to the target project");
    }
    await db.query(
      `INSERT INTO task_project_memberships (task_id, project_id, section_id)
       VALUES ($1::bigint, $2::bigint, NULL)
       ON CONFLICT (task_id, project_id) DO NOTHING`,
      [taskId, targetProjectId],
    );
    await audit(ctx.actorId, "automation.task.add_to_project", {
      entity: "task",
      entityId: taskId,
      projectId: targetProjectId,
      summary: `task ${taskId}`,
    });
    await notifyProject(targetProjectId);
    const targetWorkspace = await db.query(
      "SELECT workspace_id FROM projects WHERE id = $1::bigint",
      [targetProjectId],
    );
    if (targetWorkspace.rows[0]?.workspace_id) {
      await emitDomainEvent({
        workspaceId: Number(targetWorkspace.rows[0].workspace_id),
        projectId: targetProjectId,
        actorId: ctx.actorId,
        type: "task.added_to_project",
        subjectType: "task",
        subjectId: taskId,
        data: { project_id: targetProjectId },
        causationId: ctx.eventId ?? null,
        chainDepth: ctx.chainDepth + 1,
        correlationId: ctx.correlationId ?? null,
      });
    }
    return { summary: "タスクを別プロジェクトに追加しました", data: { project_id: targetProjectId } };
  }

  if (capability === "webhook.post") {
    const url = asString(params.url);
    if (!/^https?:\/\//i.test(url)) throw new Error("webhook URL must be http or https");
    const payload = JSON.stringify({
      source: ctx.source,
      rule_id: ctx.ruleId ?? null,
      event: ctx.event ?? null,
      project_id: ctx.projectId,
      task_id: ctx.event?.subject_type === "task" ? ctx.event.subject_id : null,
      sent_at: new Date().toISOString(),
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = asString(params.secret);
    if (secret !== "") {
      headers["x-atlas-signature"] = createHmac("sha256", secret).update(payload).digest("hex");
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`webhook returned ${response.status}`);
    return { summary: "Webhookを送信しました", data: { status: response.status } };
  }

  throw new Error(`unknown capability: ${capability}`);
}
