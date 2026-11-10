import { DOMAIN_EVENT_TYPES, type DomainEventRow, type DomainEventType } from "../domain/events";
import { configuredTaskId, hasTaskSubject } from "./task-target";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const date = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function previewEvent(
  raw: unknown,
  context: { projectId: number; workspaceId: number; actorId: number },
): { ok: true; event: DomainEventRow; warnings: string[] } | { ok: false; error: string } {
  if (!record(raw) || typeof raw.type !== "string" || !(DOMAIN_EVENT_TYPES as readonly string[]).includes(raw.type)) {
    return { ok: false, error: "event.type must explicitly name a supported domain event" };
  }
  if (Object.keys(raw).some((key) => !["type", "task_id", "data"].includes(key))) return { ok: false, error: "unsupported event property" };
  if (raw.data !== undefined && !record(raw.data)) return { ok: false, error: "event.data must be an object" };
  const data = raw.data as Record<string, unknown> | undefined ?? {};
  if (JSON.stringify(data).length > 32_768) return { ok: false, error: "event.data is too large" };
  const type = raw.type as DomainEventType;
  const taskId = configuredTaskId(raw.task_id);
  if (hasTaskSubject(type) && taskId === null) return { ok: false, error: "event.task_id is required for task events" };
  if (!hasTaskSubject(type) && raw.task_id !== undefined) return { ok: false, error: "this event does not have a task subject" };
  const ids = ["target_rule_id", "comment_id", "form_id", "field_id", "project_id", "previous_project_id",
    "section_id", "previous_section_id", "assignee_id", "previous_assignee_id", "update_id"];
  const typedData = type === "webhook.received" ? {} : data;
  for (const key of ids) if (typedData[key] !== undefined && typedData[key] !== null && configuredTaskId(typedData[key]) === null) {
    return { ok: false, error: `event.data.${key} must be a positive integer or null` };
  }
  for (const key of ["due_on", "previous_due_on", "start_on", "previous_start_on"]) {
    if (typedData[key] !== undefined && !date(typedData[key])) return { ok: false, error: `event.data.${key} must be an ISO date or null` };
  }
  for (const key of ["status", "previous_status", "body", "form_name", "field_name", "status_color"]) {
    if (typedData[key] !== undefined && typedData[key] !== null && typeof typedData[key] !== "string") return { ok: false, error: `event.data.${key} must be text or null` };
  }
  for (const key of ["completed", "is_milestone", "manual", "cleared"]) {
    if (typedData[key] !== undefined && typeof typedData[key] !== "boolean") return { ok: false, error: `event.data.${key} must be a boolean` };
  }
  if (type === "task.milestone_changed" && data.previous !== undefined && typeof data.previous !== "boolean") {
    return { ok: false, error: "event.data.previous must be a boolean" };
  }
  if (type === "form.submitted" && data.answers !== undefined && !record(data.answers)) return { ok: false, error: "event.data.answers must be an object" };
  const warnings = [
    "保存されている現在の状態と仮のイベントで評価します。実際の変更前後の状態は再現していません。",
    "テストではアクション・Webhook送信・データ更新を行いません。実行時の権限、制約、通信結果によって実際の結果は異なります。",
  ];
  const requiredData: Partial<Record<DomainEventType, string[]>> = {
    "task.assigned": ["assignee_id"], "task.status_changed": ["status"], "task.due_changed": ["due_on"],
    "task.section_changed": ["section_id"], "task.custom_field_changed": ["field_id", "value"],
    "task.milestone_changed": ["is_milestone"], "comment.created": ["body"], "comment.updated": ["body"],
    "form.submitted": ["answers"], "project.status_changed": ["status"],
  };
  const missing = (requiredData[type] ?? []).filter((key) => !Object.hasOwn(data, key));
  if (missing.length > 0) warnings.push(`イベントデータの ${missing.join(", ")} が未指定です。対応するフィルターや変数は実際のイベントと異なる場合があります。`);
  return {
    ok: true, warnings,
    event: {
      id: 0, workspace_id: context.workspaceId, project_id: context.projectId, actor_id: context.actorId,
      type, version: 1, subject_type: hasTaskSubject(type) ? "task" : type === "project.status_changed" ? "project" : "webhook",
      subject_id: hasTaskSubject(type) ? taskId! : type === "project.status_changed" ? context.projectId : 0,
      data, correlation_id: "preview", causation_id: null, chain_depth: 0, occurred_at: new Date().toISOString(), attempts: 0,
    },
  };
}
