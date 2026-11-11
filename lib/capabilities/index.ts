import { getProjectPolicyAccess } from "../project-policy-access";
import { createHmac, randomUUID } from "node:crypto";
import { db, withTransaction, type Queryable } from "../db";
import { getProjectAccess } from "../repositories/projects";
import { canEditProject } from "../project-roles";
import { logEvent } from "../repositories/tasks";
import { notifyProject } from "../notify";
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
import { postWebhook } from "../automation/webhook-outbound";
import { signWebhook } from "../automation/webhook-signature";
import { hasTaskSubject } from "../automation/task-target";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS } from "../services/task-completion";
import { assertOrdinaryTaskMutation } from "../services/task-approval-guard";
import { equalTaskCustomValue, isEmptyTaskCustomValue, normalizeTaskCustomValue } from "../task-custom-value";
import type { CustomValue } from "../custom-fields";

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
  q?: Queryable;
  notifyAfterCommit?: (projectId: number) => void;
  webhookDelivery?: { id: string; sentAt: string };
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

function actionTaskId(params: Record<string, unknown>, event: DomainEventRow | null | undefined): number | null {
  if (event?.subject_type === "task" && !hasTaskSubject(event.type)) return null;
  const id = event?.subject_type === "task" ? event.subject_id : params.task_id;
  // Planned actions may predate the validator. A rendered string is not a fixed target.
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function taskProject(taskId: number, q: Queryable): Promise<number> {
  const r = await q.query(
    "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
    [taskId],
  );
  const projectId = r.rows[0]?.project_id;
  if (!projectId) throw new Error("task not found or has no project");
  return Number(projectId);
}

async function assertEdit(ctx: CapabilityContext, projectId: number): Promise<void> {
  const access = await getProjectAccess(ctx.actorId, projectId, ctx.q);
  if (!canEditProject(access.role)) {
    throw new Error("rule owner does not have edit access to the project");
  }
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
  scopeProjectId?: number,
): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const projectId = scopeProjectId ?? await taskProject(taskId, q);
  await logEvent(taskId, ctx.actorId, eventType.replace("task.", ""), summary, q);
  await audit(ctx.actorId, `automation.${eventType}`, {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: `[${ctx.source}] ${summary}`,
  }, q);
  await emitTaskEvent({
    projectId,
    taskId,
    actorId: ctx.actorId,
    type: eventType,
    data,
    causationId: ctx.eventId ?? null,
    automationRuleId: ctx.ruleId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  }, q);
  ctx.notifyAfterCommit?.(projectId);
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
  if (!ctx.q && capability !== "webhook.post") {
    const projectIds = new Set<number>();
    const result = await withTransaction((q) => executeCapability(capability, params, {
      ...ctx,
      q,
      notifyAfterCommit: (id) => projectIds.add(id),
    }));
    await Promise.all([...projectIds].map((id) => notifyProject(id)));
    return result;
  }
  const q = ctx.q ?? db;

  if (capability === "task.assign") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.assign requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    const userId = asNumber(params.user_id);
    if (userId !== null) {
      const user = await q.query(
        "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
        [userId],
      );
      if (user.rowCount === 0) throw new Error("assignee not found");
    }
    const changed = await q.query(
      `UPDATE tasks SET assignee_id = $1::bigint, updated_at = now()
       WHERE id = $2::bigint AND assignee_id IS DISTINCT FROM $1::bigint`,
      [userId, taskId],
    );
    if (changed.rowCount === 0) return { summary: "担当者は変更されていません", data: { assignee_id: userId } };
    return finishTaskAction(ctx, taskId, "task.assigned", { assignee_id: userId }, "担当者を変更しました");
  }

  if (capability === "task.set_status") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.set_status requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    if (!(await getProjectPolicyAccess(ctx.actorId, projectId, q)).canConfigure) throw new Error("project configuration is restricted");
    const status = asString(params.status).slice(0, 64);
    if (status === "") throw new Error("status is required");
    const changed = await q.query(
      "UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2::bigint AND status IS DISTINCT FROM $1",
      [status, taskId],
    );
    if (changed.rowCount === 0) return { summary: "Statusは変更されていません", data: { status } };
    return finishTaskAction(ctx, taskId, "task.status_changed", { status }, `Statusを${status}に変更しました`);
  }

  if (capability === "task.set_due_date") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.set_due_date requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    let due = asString(params.due_on);
    if (due === "") {
      const offset = Number(params.offset_days);
      if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("valid due_on or offset_days is required");
    const current = await q.query(
      "SELECT start_on::text AS start_on FROM tasks WHERE id = $1::bigint",
      [taskId],
    );
    const start = current.rows[0]?.start_on as string | null | undefined;
    if (start && start > due) throw new Error("due date cannot be before start date");
    const changed = await q.query(
      `UPDATE tasks SET due_on = $1::date, updated_at = now()
       WHERE id = $2::bigint AND due_on IS DISTINCT FROM $1::date`,
      [due, taskId],
    );
    if (changed.rowCount === 0) return { summary: "期日は変更されていません", data: { due_on: due } };
    return finishTaskAction(ctx, taskId, "task.due_changed", { due_on: due }, `期日を${due}に変更しました`);
  }

  if (capability === "task.move_section") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.move_section requires a task");
    const task = await q.query(
      "SELECT project_id, section_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
      [taskId],
    );
    const primaryProjectId = task.rows[0]?.project_id;
    if (!primaryProjectId) throw new Error("task not found or has no project");
    const taskEvent = ctx.event?.subject_type === "task";
    const projectId = taskEvent ? ctx.projectId : Number(primaryProjectId);
    if (ctx.event && ctx.event.project_id !== ctx.projectId) throw new Error("invalid source project");
    if (ctx.event && !taskEvent) await assertEdit(ctx, ctx.projectId);
    await assertEdit(ctx, projectId);
    const sectionId = asNumber(params.section_id);
    if (!sectionId) throw new Error("section_id is required");
    const section = await q.query(
      "SELECT project_id FROM sections WHERE id = $1::bigint FOR KEY SHARE",
      [sectionId],
    );
    if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
      throw new Error("section does not belong to the task project");
    }
    let previousSection: number | null = task.rows[0].section_id;
    const secondary = Number(primaryProjectId) !== projectId;
    if (secondary) {
      const membership = await q.query(
        `SELECT section_id FROM task_project_memberships
         WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE`,
        [taskId, projectId],
      );
      if (membership.rowCount === 0) throw new Error("source project task membership not found");
      previousSection = membership.rows[0].section_id;
    }
    if (previousSection === sectionId) {
      return { summary: "セクションは変更されていません", data: { project_id: projectId, section_id: sectionId, unchanged: true } };
    }
    if (secondary) {
      await q.query(
        `UPDATE task_project_memberships SET section_id = $3::bigint
         WHERE task_id = $1::bigint AND project_id = $2::bigint`,
        [taskId, projectId, sectionId],
      );
      // The normal task editor uses this shared version for secondary placement too.
      await q.query("UPDATE tasks SET updated_at = now() WHERE id = $1::bigint", [taskId]);
    } else {
      await q.query(
        "UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = $2::bigint",
        [sectionId, taskId],
      );
    }
    await q.query(
      "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
      [taskId, projectId],
    );
    return finishTaskAction(
      ctx,
      taskId,
      "task.section_changed",
      { project_id: projectId, previous_section_id: previousSection, section_id: sectionId },
      "セクションを変更しました",
      projectId,
    );
  }

  if (capability === "task.complete") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.complete requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    await assertOrdinaryTaskMutation(q, [taskId], { completed: true });
    const changed = await q.query(
      `UPDATE tasks SET completed = TRUE, completed_at = now(), updated_at = now()
       WHERE id = $1::bigint AND project_id = $2::bigint AND deleted_at IS NULL AND NOT completed
       RETURNING ${TASK_COMPLETION_COLUMNS}`,
      [taskId, projectId],
    );
    if (changed.rowCount) {
      await recordTaskCompletion(q, {
        task: changed.rows[0],
        projectId,
        actorId: ctx.actorId,
        data: { completed: true },
        causationId: ctx.eventId ?? null,
        automationRuleId: ctx.ruleId ?? null,
        chainDepth: ctx.chainDepth + 1,
        correlationId: ctx.correlationId ?? null,
      });
      await audit(ctx.actorId, "automation.task.completed", {
        entity: "task",
        entityId: taskId,
        projectId,
        summary: "タスクを完了しました",
      }, q);
      ctx.notifyAfterCommit?.(projectId);
    }
    return { summary: "タスクを完了しました", data: { completed: true } };
  }

  if (capability === "task.add_comment") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.add_comment requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    const body = typeof params.body === "string" ? params.body : "";
    const parsed = await parseCommentPayload(projectId, { body }, q);
    if (!parsed.ok) throw new Error(parsed.error);
    const inserted = await q.query(
      `INSERT INTO comments (task_id, author_id, body, body_doc)
       VALUES ($1::bigint, $2, $3, $4::jsonb) RETURNING id`,
      [taskId, ctx.actorId, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
    );
    const commentId = Number(inserted.rows[0].id);
    await replaceCommentMentions(commentId, parsed.mentionIds, q);
    await audit(ctx.actorId, "automation.comment.create", {
      entity: "comment",
      entityId: commentId,
      projectId,
      summary: parsed.text.slice(0, 120),
    }, q);
    ctx.notifyAfterCommit?.(projectId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "comment.created",
      data: { comment_id: commentId, body: parsed.text.slice(0, 500) },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    }, q);
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
      const section = await q.query(
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
    const inserted = await q.query(
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
    await logEvent(taskId, ctx.actorId, "created", "タスクをルールから作成しました", q);
    await audit(ctx.actorId, "automation.task.create", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: name,
    }, q);
    ctx.notifyAfterCommit?.(projectId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "task.created",
      data: { created_by_rule: true },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    }, q);
    return { summary: "タスクを作成しました", data: { task_id: taskId } };
  }

  if (capability === "task.create_subtask") {
    const parentId = actionTaskId(params, ctx.event);
    if (!parentId) throw new Error("task.create_subtask requires a parent task");
    const parent = await q.query(
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
    const inserted = await q.query(
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
    await logEvent(taskId, ctx.actorId, "created", "サブタスクをルールから作成しました", q);
    await audit(ctx.actorId, "automation.task.create_subtask", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: name,
    }, q);
    ctx.notifyAfterCommit?.(projectId);
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: ctx.actorId,
      type: "task.created",
      data: { parent_task_id: parentId, created_by_rule: true },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    }, q);
    return { summary: "サブタスクを作成しました", data: { task_id: taskId } };
  }

  if (capability === "task.set_custom_field") {
    const taskId = actionTaskId(params, ctx.event);
    if (!taskId) throw new Error("task.set_custom_field requires a task");
    const projectId = await taskProject(taskId, q);
    await assertEdit(ctx, projectId);
    const fieldId = asNumber(params.field_id);
    if (!fieldId) throw new Error("field_id is required");
    const field = await q.query(
      `SELECT id, name, field_type, project_id, config, access_level, editor_ids
       FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL`,
      [fieldId],
    );
    if (field.rowCount === 0 || Number(field.rows[0].project_id) !== projectId) {
      throw new Error("custom field not found");
    }
    if (!(await canEditFieldValue(ctx.actorId, projectId, field.rows[0], q))) {
      throw new Error("field access denied");
    }
    const value = params.value;
    const normalized = await normalizeTaskCustomValue(field.rows[0], value, ctx.actorId, q);
    if (!normalized.ok) throw new Error(`invalid custom field value: ${normalized.error}`);
    const current = await q.query(
      `SELECT value_text, value_number, value_date::text AS value_date, value_json
       FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint`,
      [taskId, fieldId],
    );
    if (equalTaskCustomValue(current.rows[0] as CustomValue | undefined, normalized.value)) {
      return { summary: "カスタムフィールドの値は変更されませんでした", data: { unchanged: true } };
    }
    const { value_text: text, value_number: num, value_date: date, value_json: json } = normalized.value;
    if (isEmptyTaskCustomValue(normalized.value)) {
      await q.query(
        "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
        [taskId, fieldId],
      );
    } else {
      await q.query(
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
    if (!(await getProjectPolicyAccess(ctx.actorId, projectId, q)).canConfigure) throw new Error("project configuration is restricted");
    const status = asString(params.status);
    if (status === "") throw new Error("status is required");
    const color = isProjectStatusColor(params.status_color) ? params.status_color : "none";
    await createProjectStatusUpdate(
      projectId,
      ctx.actorId,
      "ルールによりプロジェクトステータスを更新しました",
      status.slice(0, 80),
      color,
      q,
    );
    await audit(ctx.actorId, "automation.project.status", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: status,
    }, q);
    ctx.notifyAfterCommit?.(projectId);
    const workspace = await q.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
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
        automationRuleId: ctx.ruleId ?? null,
        chainDepth: ctx.chainDepth + 1,
        correlationId: ctx.correlationId ?? null,
      }, q);
    }
    return { summary: `プロジェクトステータスを${status}に変更しました`, data: { status } };
  }

  if (capability === "task.add_to_project") {
    const taskId = actionTaskId(params, ctx.event);
    const targetProjectId = asNumber(params.project_id);
    if (!taskId || !targetProjectId) throw new Error("task.add_to_project requires task and project");
    const sourceProjectId = await taskProject(taskId, q);
    await assertEdit(ctx, sourceProjectId);
    await assertEdit(ctx, targetProjectId);
    const primary = await q.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [taskId]);
    if (Number(primary.rows[0]?.project_id) === targetProjectId) {
      return { summary: "タスクはすでにプロジェクトに所属しています", data: { project_id: targetProjectId } };
    }
    const added = await q.query(
      `INSERT INTO task_project_memberships (task_id, project_id, section_id)
       VALUES ($1::bigint, $2::bigint, NULL)
       ON CONFLICT (task_id, project_id) DO NOTHING`,
      [taskId, targetProjectId],
    );
    if (added.rowCount === 0) {
      return { summary: "タスクはすでにプロジェクトに所属しています", data: { project_id: targetProjectId } };
    }
    await audit(ctx.actorId, "automation.task.add_to_project", {
      entity: "task",
      entityId: taskId,
      projectId: targetProjectId,
      summary: `task ${taskId}`,
    }, q);
    ctx.notifyAfterCommit?.(targetProjectId);
    const targetWorkspace = await q.query(
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
        automationRuleId: ctx.ruleId ?? null,
        chainDepth: ctx.chainDepth + 1,
        correlationId: ctx.correlationId ?? null,
      }, q);
    }
    return { summary: "タスクを別プロジェクトに追加しました", data: { project_id: targetProjectId } };
  }

  if (capability === "webhook.post") {
    const url = asString(params.url);
    const payload = JSON.stringify({
      source: ctx.source,
      rule_id: ctx.ruleId ?? null,
      event: ctx.event ?? null,
      project_id: ctx.projectId,
      task_id: ctx.event?.subject_type === "task" ? ctx.event.subject_id : null,
      sent_at: ctx.webhookDelivery?.sentAt ?? new Date().toISOString(),
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = asString(params.secret);
    const deliveryId = ctx.webhookDelivery?.id ?? randomUUID();
    headers["Idempotency-Key"] = deliveryId;
    headers["x-atlas-delivery-id"] = deliveryId;
    if (secret !== "") {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers["x-atlas-timestamp"] = timestamp;
      headers["x-atlas-signature-v2"] = signWebhook(secret, timestamp, deliveryId, payload);
      // Keep the body-only signature for existing external recipients.
      headers["x-atlas-signature"] = createHmac("sha256", secret).update(payload).digest("hex");
    }
    const status = await postWebhook(url, payload, headers);
    if (status >= 300 && status < 400) throw new Error("invalid webhook destination: redirects are not allowed");
    if (status < 200 || status >= 300) throw new Error(`webhook returned ${status}`);
    return { summary: "Webhookを送信しました", data: { status } };
  }

  throw new Error(`unknown capability: ${capability}`);
}
