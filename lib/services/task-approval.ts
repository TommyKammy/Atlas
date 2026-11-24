import { withTransaction, type Queryable } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../api/errors";
import { getProjectAccess } from "../repositories/projects";
import { getTaskProjectContext } from "../api-project-auth";
import { canEditProject, canManageProject, canViewProject } from "../project-roles";
import { lockAutomationProjectAccess } from "../project-automation-lock";
import { audit } from "../audit";
import { notifyProject } from "../notify";
import { emitTaskEvent } from "../domain/events";
import { insertTaskEvent } from "../repositories/tasks";
import { runAutomations } from "../automation-runner";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS, type TaskCompletionRow } from "./task-completion";
import {
  TASK_APPROVAL_ACTIONS, TASK_APPROVAL_ACTION_LABELS,
  type TaskApprovalAction, type TaskApprovalDetail, type TaskApprovalHistoryEntry,
  type TaskApprovalResponse, type TaskApprovalStatus,
} from "../task-approval";

type ApprovalTask = {
  id: number;
  project_id: number | null;
  completed: boolean;
  is_milestone: boolean;
  recurrence: string;
  updated_at: string;
};

type ApprovalRow = {
  task_id: number;
  status: TaskApprovalStatus;
  approver_id: number | null;
  requester_id: number | null;
  round: number;
  version: number;
  requested_at: string;
  decided_at: string | null;
  approver_name: string | null;
  requester_name: string | null;
};

async function task(q: Queryable, taskId: number, lock = false): Promise<ApprovalTask> {
  const row = await q.query(
    `SELECT t.id, t.project_id, t.completed, t.is_milestone, t.recurrence,
       t.updated_at::text AS updated_at
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1::bigint AND t.deleted_at IS NULL
       AND (t.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
     ${lock ? "FOR UPDATE OF t" : ""}`,
    [taskId],
  );
  if (!row.rows[0]) throw notFound("task not found");
  return row.rows[0] as ApprovalTask;
}

async function approval(q: Queryable, taskId: number): Promise<ApprovalRow | null> {
  const rows = await q.query(
    `SELECT a.task_id, a.status, a.approver_id, a.requester_id, a.round, a.version,
       a.requested_at::text AS requested_at, a.decided_at::text AS decided_at,
       approver.name AS approver_name, requester.name AS requester_name
     FROM task_approvals a
     LEFT JOIN users approver ON approver.id = a.approver_id
     LEFT JOIN users requester ON requester.id = a.requester_id
     WHERE a.task_id = $1::bigint`,
    [taskId],
  );
  return rows.rows[0] as ApprovalRow | undefined ?? null;
}

async function assertView(q: Queryable, taskId: number, uid: number): Promise<void> {
  const context = await getTaskProjectContext(taskId, q);
  if (!context) throw notFound("task not found");
  if (context.projectIds.length === 0) {
    const user = await q.query("SELECT id FROM users WHERE id = $1 AND is_admin AND deactivated_at IS NULL", [uid]);
    if (user.rowCount) return;
  } else {
    const projects = await q.query("SELECT id FROM projects WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL", [context.projectIds]);
    for (const project of projects.rows) {
      if (canViewProject((await getProjectAccess(uid, Number(project.id), q)).role)) return;
    }
  }
  throw forbidden("task access denied");
}

/** Hold live membership/user permissions through this approval mutation. */
async function lockActor(q: Queryable, uid: number, projectId: number): Promise<void> {
  await q.query("SELECT id FROM users WHERE id = $1::bigint FOR SHARE", [uid]);
  await q.query("SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = $2 FOR SHARE", [projectId, uid]);
}

async function response(q: Queryable, current: ApprovalTask, uid: number): Promise<TaskApprovalResponse> {
  const saved = await approval(q, current.id);
  const access = current.project_id === null ? { role: null } : await getProjectAccess(uid, current.project_id, q);
  const editable = canEditProject(access.role);
  const canRequest = editable && !saved && !current.is_milestone && current.recurrence === "none";
  const canManage = editable && saved !== null && (saved.requester_id === uid || canManageProject(access.role));
  const requesterId = saved?.requester_id ?? uid;
  const candidates = canRequest || canManage
    ? await q.query(
      `SELECT u.id, u.name FROM users u
       LEFT JOIN project_members pm ON pm.project_id = $1 AND pm.user_id = u.id
       WHERE u.deactivated_at IS NULL AND u.id <> $2 AND u.id <> $3
         AND (u.is_admin OR pm.role IN ('admin', 'editor', 'member'))
       ORDER BY u.name, u.id`,
      [current.project_id, requesterId, uid],
    )
    : { rows: [] };
  const history = saved ? await q.query(
    `SELECT id, action, round, version, actor_id, actor_name, approver_id, approver_name,
       comment, created_at::text AS created_at
     FROM task_approval_history WHERE task_id = $1 ORDER BY version`,
    [current.id],
  ) : { rows: [] };
  const detail: TaskApprovalDetail | null = saved ? {
    ...saved, task_id: Number(saved.task_id),
    approver_id: saved.approver_id === null ? null : Number(saved.approver_id),
    requester_id: saved.requester_id === null ? null : Number(saved.requester_id),
    round: Number(saved.round), version: Number(saved.version), task_updated_at: current.updated_at,
  } : null;
  return {
    task_updated_at: current.updated_at,
    approval: detail,
    history: history.rows as TaskApprovalHistoryEntry[],
    eligible_approvers: candidates.rows.map((row) => ({ id: Number(row.id), name: String(row.name) })),
    can_request: canRequest,
    can_manage: canManage,
    can_decide: editable && saved?.status === "pending" && saved.approver_id === uid && saved.requester_id !== uid,
  };
}

export async function getTaskApproval(taskId: number, uid: number): Promise<TaskApprovalResponse> {
  return withTransaction(async (q) => {
    await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const current = await task(q, taskId);
    await assertView(q, taskId, uid);
    return response(q, current, uid);
  });
}

type ApprovalMutation = {
  action: TaskApprovalAction;
  approverId?: number;
  comment: string;
  version: number;
  stamp: string;
};

function isTaskStamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  // Accept both the PostgreSQL ::text stamp and ISO timestamps, including the
  // original microseconds. Keep the unmodified string as the opaque CAS token.
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5])(?::?[0-5]\d)?)$/);
  if (!match) return false;
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return false;
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return Number.isFinite(Date.parse(normalized));
}

function mutation(body: unknown): ApprovalMutation {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("invalid approval operation");
  const input = body as Record<string, unknown>;
  if (!(TASK_APPROVAL_ACTIONS as readonly unknown[]).includes(input.action)) throw badRequest("invalid approval action");
  if (typeof input.expected_version !== "number" || !Number.isInteger(input.expected_version) ||
      input.expected_version < 0 || input.expected_version >= 2_147_483_647) throw badRequest("expected_version is required");
  if (!isTaskStamp(input.expected_updated_at)) {
    throw badRequest("expected_updated_at is required");
  }
  if (input.comment !== undefined && typeof input.comment !== "string") throw badRequest("comment must be text");
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 4000) throw badRequest("comment must be at most 4000 characters");
  const action = input.action as TaskApprovalAction;
  if ((action === "reject" || action === "request_changes") && comment === "") throw badRequest("却下・差し戻しには理由を入力してください");
  let approverId: number | undefined;
  if (action === "request" || action === "resubmit" || action === "reassign") {
    if (typeof input.approver_id !== "number" || !Number.isSafeInteger(input.approver_id) || input.approver_id <= 0) {
      throw badRequest("approver_id is required");
    }
    approverId = input.approver_id;
  }
  return { action, approverId, comment, version: input.expected_version, stamp: input.expected_updated_at };
}

export async function updateTaskApproval(taskId: number, uid: number, body: unknown): Promise<TaskApprovalResponse> {
  const input = mutation(body);
  const result = await withTransaction(async (q) => {
    await lockAutomationProjectAccess(q);
    const current = await task(q, taskId, true);
    if (current.project_id === null) throw forbidden("承認タスクには主プロジェクトが必要です");
    await lockActor(q, uid, current.project_id);
    const access = await getProjectAccess(uid, current.project_id, q);
    if (!canEditProject(access.role)) throw forbidden("承認操作には主プロジェクトの編集権限が必要です");
    const previous = await approval(q, taskId);
    if (current.updated_at !== input.stamp || (previous?.version ?? 0) !== input.version) {
      throw conflict("承認の内容が変更されています。最新の状態を読み込んでください");
    }
    const requesting = input.action === "request" || input.action === "resubmit" || input.action === "reassign";
    const manager = previous !== null && (previous.requester_id === uid || canManageProject(access.role));
    if (requesting) {
      if (current.is_milestone || current.recurrence !== "none") throw conflict("マイルストーン・繰り返しタスクは承認タスクにできません");
      if (input.action === "request" && previous !== null) throw conflict("このタスクは既に承認タスクです");
      if (input.action !== "request" && !previous) throw conflict("承認が申請されていません");
      if (input.action !== "request" && !manager) throw forbidden("再申請・承認者変更は申請者またはプロジェクト管理者だけが行えます");
      if (input.action === "resubmit" && previous?.status === "pending") throw conflict("承認待ちの申請は再申請できません");
      if (input.action === "reassign" && previous?.status !== "pending") throw conflict("承認待ちの申請だけ承認者を変更できます");
    } else {
      if (!previous || previous.status !== "pending") throw conflict("この申請は承認待ちではありません");
      if (previous.approver_id !== uid || previous.requester_id === uid) throw forbidden("指定された承認者だけが判断できます");
    }

    const requesterId = previous?.requester_id ?? uid;
    const approverId = requesting ? input.approverId! : previous!.approver_id!;
    if (approverId === requesterId) throw badRequest("申請者は自分の申請を承認できません");
    if (requesting && approverId === uid) throw badRequest("申請・承認者変更を行うユーザーは自分を承認者に指定できません");
    await lockActor(q, approverId, current.project_id);
    const approverAccess = await getProjectAccess(approverId, current.project_id, q);
    if (!canEditProject(approverAccess.role)) throw badRequest("承認者には主プロジェクトを編集できる有効なユーザーを指定してください");
    if (input.action === "reassign" && approverId === previous?.approver_id) throw badRequest("別の承認者を指定してください");
    const people = await q.query("SELECT id, name FROM users WHERE id = ANY($1::bigint[])", [[uid, approverId]]);
    const actorName = String(people.rows.find((row) => row.id === uid)?.name ?? "削除されたユーザー");
    const approverName = String(people.rows.find((row) => row.id === approverId)?.name ?? "削除されたユーザー");
    const nextStatus: TaskApprovalStatus = requesting ? "pending" : input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "changes_requested";
    const version = input.version + 1;
    const round = previous ? previous.round + (requesting ? 1 : 0) : 1;
    if (previous) {
      await q.query(
        `UPDATE task_approvals SET status = $2, approver_id = $3, requester_id = $4,
           round = $5, version = $6, requested_at = CASE WHEN $7 THEN clock_timestamp() ELSE requested_at END,
           decided_at = CASE WHEN $7 THEN NULL ELSE clock_timestamp() END
         WHERE task_id = $1`,
        [taskId, nextStatus, approverId, requesterId, round, version, requesting],
      );
    } else {
      await q.query(
        `INSERT INTO task_approvals(task_id, status, approver_id, requester_id, round, version)
         VALUES ($1, $2, $3, $4, $5, $6)`, [taskId, nextStatus, approverId, requesterId, round, version],
      );
    }
    const completed = nextStatus === "approved";
    const updated = await q.query(
      `UPDATE tasks SET completed = $2,
         completed_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
       WHERE id = $1 RETURNING ${TASK_COMPLETION_COLUMNS}`,
      [taskId, completed],
    );
    if (current.completed !== completed) {
      await recordTaskCompletion(q, { task: updated.rows[0] as TaskCompletionRow,
        projectId: current.project_id, actorId: uid, data: { approval: true, approval_version: version } });
    }
    const summary = `${TASK_APPROVAL_ACTION_LABELS[input.action]}（承認者: ${approverName}）`;
    const eventId = await insertTaskEvent(q, {
      taskId,
      actorId: uid,
      kind: `approval_${input.action}`,
      summary,
    });
    await q.query(
      `INSERT INTO task_approval_history(task_id,action,round,version,actor_id,actor_name,
         approver_id,approver_name,comment,event_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [taskId, input.action, round, version, uid, actorName, approverId, approverName, input.comment, eventId],
    );
    const recipients = requesting
      ? [approverId, ...(input.action === "reassign" ? [previous?.approver_id, requesterId] : [])]
      : [requesterId];
    const distinctRecipients = [...new Set(recipients.filter((id): id is number => typeof id === "number" && id !== uid))];
    if (distinctRecipients.length) {
      await q.query(
        `INSERT INTO task_event_recipients(event_id,user_id)
         SELECT $1, user_id FROM unnest($2::bigint[]) AS user_id ON CONFLICT DO NOTHING`,
        [eventId, distinctRecipients],
      );
    }
    await audit(uid, `task.approval.${input.action}`, { entity: "task", entityId: taskId, projectId: current.project_id, summary }, q);
    await emitTaskEvent({ projectId: current.project_id, taskId, actorId: uid,
      type: "task.approval_changed", data: { action: input.action, previous: previous?.status ?? null, next: nextStatus, round, approval_version: version } }, q);
    const next = await task(q, taskId);
    const dto = await response(q, next, uid);
    const projects = await getTaskProjectContext(taskId, q);
    return { dto, projects: projects?.projectIds ?? [current.project_id],
      primaryProjectId: current.project_id, becameCompleted: !current.completed && completed };
  });
  // Keep the legacy task_completed contract used by ordinary PATCH and bulk
  // completion. Its best-effort side effects stay outside the approval commit.
  if (result.becameCompleted) {
    await runAutomations(result.primaryProjectId, taskId, "task_completed").catch(() => undefined);
  }
  await Promise.all(result.projects.map((projectId) => notifyProject(projectId)));
  return result.dto;
}
