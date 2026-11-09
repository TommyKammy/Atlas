import { db } from "../db";
import type { DomainEventRow } from "../domain/events";
import { emitDomainEvent } from "../domain/events";
import { executeCapability, type CapabilityContext } from "../capabilities";
import {
  getProjectRules,
  recordRuleRun,
} from "./repository";
import {
  RULE_LIMITS,
  type ProjectRule,
  type RuleAction,
  type RuleCondition,
  type RuleDefinition,
  type RuleRunActionDetail,
} from "./types";

type RuleSnapshot = {
  task: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  custom: Record<string, unknown>;
  event: DomainEventRow;
};

const MAX_EVENTS_PER_TICK = 20;
let lastScheduleScan = 0;

function eventRow(row: Record<string, unknown>): DomainEventRow {
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    project_id: row.project_id === null ? null : Number(row.project_id),
    actor_id: row.actor_id === null ? null : Number(row.actor_id),
    type: row.type as DomainEventRow["type"],
    version: Number(row.version ?? 1),
    subject_type: String(row.subject_type),
    subject_id: Number(row.subject_id),
    data: (row.data ?? {}) as Record<string, unknown>,
    correlation_id: row.correlation_id === null ? null : String(row.correlation_id),
    causation_id: row.causation_id === null ? null : Number(row.causation_id),
    chain_depth: Number(row.chain_depth ?? 0),
    occurred_at: String(row.occurred_at),
    attempts: Number(row.attempts ?? 0),
  };
}

async function claimEvent(): Promise<DomainEventRow | null> {
  const r = await db.query(
    `WITH candidate AS (
       SELECT id FROM domain_events
       WHERE processed_at IS NULL AND failed_at IS NULL
         AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE domain_events e
     SET processing_at = now(), attempts = attempts + 1
     FROM candidate c
     WHERE e.id = c.id
     RETURNING e.*`,
  );
  return r.rowCount === 0 ? null : eventRow(r.rows[0]);
}

function pathValue(source: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function comparable(actual: unknown): string | number | boolean | null {
  if (actual === null || actual === undefined) return null;
  if (typeof actual === "number" || typeof actual === "boolean") return actual;
  if (typeof actual === "string") {
    if (actual === "true") return true;
    if (actual === "false") return false;
    return actual;
  }
  return JSON.stringify(actual);
}

function matchCondition(condition: RuleCondition, snapshot: RuleSnapshot): boolean {
  let actual: unknown;
  if (condition.field.startsWith("task.")) {
    actual = snapshot.task ? pathValue(snapshot.task, condition.field.slice(5)) : undefined;
  } else if (condition.field.startsWith("project.")) {
    actual = snapshot.project ? pathValue(snapshot.project, condition.field.slice(8)) : undefined;
  } else if (condition.field.startsWith("custom.")) {
    actual = snapshot.custom[condition.field.slice(7)];
  } else if (condition.field.startsWith("event.")) {
    actual = pathValue(snapshot.event, condition.field.slice(6));
  } else {
    actual = pathValue({ task: snapshot.task, project: snapshot.project }, condition.field);
  }

  const expected = condition.value;
  const a = comparable(actual);
  const e = comparable(expected);

  switch (condition.op) {
    case "eq":
      return a === e || (a !== null && e !== null && String(a) === String(e));
    case "neq":
      return !(a === e || (a !== null && e !== null && String(a) === String(e)));
    case "contains":
      if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
      return a !== null && String(a).includes(String(expected ?? ""));
    case "not_contains":
      if (Array.isArray(actual)) return !actual.map(String).includes(String(expected));
      return a === null || !String(a).includes(String(expected ?? ""));
    case "in": {
      const list = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
      return a !== null && list.includes(String(a));
    }
    case "not_in": {
      const list = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
      return a === null || !list.includes(String(a));
    }
    case "is_empty":
      return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "is_not_empty":
      return !(actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = typeof a === "number" ? a : Number(a);
      const right = typeof e === "number" ? e : Number(e);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        const ls = String(a ?? "");
        const rs = String(e ?? "");
        if (condition.op === "gt") return ls > rs;
        if (condition.op === "gte") return ls >= rs;
        if (condition.op === "lt") return ls < rs;
        return ls <= rs;
      }
      if (condition.op === "gt") return left > right;
      if (condition.op === "gte") return left >= right;
      if (condition.op === "lt") return left < right;
      return left <= right;
    }
    default:
      return false;
  }
}

function renderTemplate(value: unknown, snapshot: RuleSnapshot): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
      const path = rawPath.trim();
      let resolved: unknown;
      if (path.startsWith("task.") && snapshot.task) {
        resolved = pathValue(snapshot.task, path.slice(5));
      } else if (path.startsWith("project.") && snapshot.project) {
        resolved = pathValue(snapshot.project, path.slice(8));
      } else if (path.startsWith("custom.")) {
        resolved = snapshot.custom[path.slice(7)];
      } else if (path.startsWith("event.")) {
        resolved = pathValue(snapshot.event, path.slice(6));
      }
      return resolved === null || resolved === undefined ? "" : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => renderTemplate(entry, snapshot));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        renderTemplate(entry, snapshot),
      ]),
    );
  }
  return value;
}

function renderActions(actions: RuleAction[], snapshot: RuleSnapshot): RuleAction[] {
  return actions.map((action) => ({
    capability: action.capability,
    params: renderTemplate(action.params ?? {}, snapshot) as Record<string, unknown>,
  }));
}

function triggerMatches(rule: ProjectRule, event: DomainEventRow): boolean {
  const targetRule = event.data?.target_rule_id;
  if (targetRule !== undefined && Number(targetRule) !== rule.id) return false;
  const triggers = rule.definition.triggers ?? [];
  return triggers.some((trigger) => {
    if (trigger.event !== event.type) return false;
    if (!trigger.filters) return true;
    return Object.entries(trigger.filters).every(([key, value]) => {
      const actual = pathValue(event.data, key) ?? pathValue(event, key);
      return String(actual) === String(value);
    });
  });
}

async function loadSnapshot(event: DomainEventRow): Promise<RuleSnapshot> {
  let task: Record<string, unknown> | null = null;
  let project: Record<string, unknown> | null = null;
  const custom: Record<string, unknown> = {};

  if (event.project_id !== null) {
    const p = await db.query(
      `SELECT id, name, status, status_color, owner_id, due_on::text AS due_on
       FROM projects WHERE id = $1::bigint`,
      [event.project_id],
    );
    project = p.rows[0] ?? null;
  }

  if (event.subject_type === "task") {
    const t = await db.query(
      `SELECT id, project_id, section_id, parent_task_id, name, description,
         assignee_id, created_by, completed, start_on::text AS start_on,
         due_on::text AS due_on, progress, status, position,
         created_at::text AS created_at, updated_at::text AS updated_at
       FROM tasks WHERE id = $1::bigint`,
      [event.subject_id],
    );
    task = t.rows[0] ?? null;
    if (task && !project) {
      const p = await db.query(
        `SELECT id, name, status, status_color, owner_id, due_on::text AS due_on
         FROM projects WHERE id = $1::bigint`,
        [task.project_id],
      );
      project = p.rows[0] ?? null;
    }
    const values = await db.query(
      `SELECT v.field_id, v.value_text, v.value_number, v.value_date::text AS value_date,
         v.value_json, f.name AS field_name, f.field_type
       FROM task_custom_values v
       JOIN custom_fields f ON f.id = v.field_id
       WHERE v.task_id = $1::bigint`,
      [event.subject_id],
    );
    for (const row of values.rows) {
      const value =
        row.value_number !== null && row.value_number !== undefined
          ? row.value_number
          : row.value_date !== null && row.value_date !== undefined
            ? row.value_date
            : row.value_json !== null && row.value_json !== undefined
              ? row.value_json
              : row.value_text;
      custom[String(row.field_id)] = value;
      custom[String(row.field_name)] = value;
    }
  }

  if (event.subject_type === "project" && !project) {
    const p = await db.query(
      `SELECT id, name, status, status_color, owner_id, due_on::text AS due_on
       FROM projects WHERE id = $1::bigint`,
      [event.subject_id],
    );
    project = p.rows[0] ?? null;
  }

  return { task, project, custom, event };
}

function chooseActions(definition: RuleDefinition, snapshot: RuleSnapshot): RuleAction[] | null {
  const globalConditions = definition.conditions ?? [];
  if (!globalConditions.every((condition) => matchCondition(condition, snapshot))) {
    return null;
  }
  const branches = definition.branches ?? [];
  if (branches.length === 0) return definition.actions ?? [];
  const normal = branches.filter((branch) => branch.else !== true);
  for (const branch of normal) {
    if (branch.conditions.every((condition) => matchCondition(condition, snapshot))) {
      return branch.actions;
    }
  }
  const fallback = branches.find((branch) => branch.else === true);
  return fallback?.actions ?? null;
}

async function runRule(
  rule: ProjectRule,
  event: DomainEventRow,
  snapshot: RuleSnapshot,
): Promise<boolean> {
  if (!triggerMatches(rule, event)) return false;
  const actions = chooseActions(rule.definition, snapshot);
  if (actions === null || actions.length === 0) return false;
  if (!rule.owner_id) {
    await recordRuleRun({
      rule,
      eventId: event.id,
      source: "automation",
      status: "failed",
      details: [],
      error: "rule owner is missing",
    });
    return true;
  }

  const already = await db.query(
    `SELECT 1 FROM rule_runs
     WHERE rule_id = $1::bigint AND event_id = $2::bigint AND status = 'success'
     LIMIT 1`,
    [rule.id, event.id],
  );
  if ((already.rowCount ?? 0) > 0) return true;

  const rendered = renderActions(actions, snapshot);
  const details: RuleRunActionDetail[] = [];
  let failure: string | null = null;
  const ctx: CapabilityContext = {
    actorId: rule.owner_id,
    source: "automation",
    projectId: event.project_id ?? rule.project_id,
    correlationId: event.correlation_id ?? `event:${event.id}`,
    eventId: event.id,
    chainDepth: event.chain_depth,
    ruleId: rule.id,
    event,
  };

  for (const [index, action] of rendered.entries()) {
    const params: Record<string, unknown> = { ...action.params };
    if (event.subject_type === "task") params.task_id = event.subject_id;
    if (event.subject_type === "project") params.project_id = event.subject_id;
    try {
      const result = await executeCapability(action.capability, params, ctx);
      details.push({
        index,
        capability: action.capability,
        params,
        status: "success",
        result: result.data ?? { summary: result.summary },
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      details.push({
        index,
        capability: action.capability,
        params,
        status: "failed",
        error: message,
      });
      failure = message;
      break;
    }
  }

  await recordRuleRun({
    rule,
    eventId: event.id,
    source: "automation",
    status: failure ? "failed" : "success",
    details,
    error: failure,
  });
  return true;
}

async function processEvent(event: DomainEventRow): Promise<void> {
  if (event.chain_depth > RULE_LIMITS.chainDepth) {
    await db.query(
      "UPDATE domain_events SET processed_at = now(), processing_at = NULL, last_error = $2 WHERE id = $1",
      [event.id, `chain depth exceeded (${event.chain_depth})`],
    );
    return;
  }
  if (event.project_id === null) {
    await db.query(
      "UPDATE domain_events SET processed_at = now(), processing_at = NULL WHERE id = $1",
      [event.id],
    );
    return;
  }
  const rules = await getProjectRules(event.project_id);
  const snapshot = await loadSnapshot(event);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      await runRule(rule, event, snapshot);
    } catch (caught) {
      await recordRuleRun({
        rule,
        eventId: event.id,
        source: "automation",
        status: "failed",
        details: [],
        error: caught instanceof Error ? caught.message : String(caught),
      }).catch(() => undefined);
    }
  }
  await db.query(
    "UPDATE domain_events SET processed_at = now(), processing_at = NULL, last_error = NULL WHERE id = $1",
    [event.id],
  );
}

/** Scan date-based triggers and emit deduplicated rule-specific events. */
export async function processScheduledTriggers(): Promise<number> {
  const rules = await db.query(
    `SELECT r.id, r.workspace_id, r.project_id, r.name, r.description, r.definition,
       r.owner_id, u.name AS owner_name, r.enabled, r.version,
       r.created_at::text AS created_at, r.updated_at::text AS updated_at,
       NULL::text AS last_run_at, NULL::text AS last_run_status
     FROM project_rules r LEFT JOIN users u ON u.id = r.owner_id
     WHERE r.enabled = TRUE AND r.owner_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(r.definition->'triggers','[]'::jsonb)) t
         WHERE t->>'event' IN ('task.due_soon','task.overdue')
       )`,
  );
  let emitted = 0;
  for (const raw of rules.rows) {
    const rule: ProjectRule = {
      ...(raw as ProjectRule),
      id: Number(raw.id),
      workspace_id: Number(raw.workspace_id),
      project_id: Number(raw.project_id),
      owner_id: raw.owner_id === null ? null : Number(raw.owner_id),
      version: Number(raw.version),
    };
    const triggers = (rule.definition.triggers ?? []).filter(
      (trigger) => trigger.event === "task.due_soon" || trigger.event === "task.overdue",
    );
    for (const trigger of triggers) {
      const days = Math.max(0, Math.floor(Number(trigger.days ?? 0)));
      const dueCondition =
        trigger.event === "task.due_soon"
          ? "t.due_on = CURRENT_DATE + $2::int"
          : "t.due_on < CURRENT_DATE - $2::int";
      const tasks = await db.query(
        `SELECT t.id, t.due_on::text AS due_on, t.name FROM tasks t
         WHERE t.project_id = $1::bigint AND t.deleted_at IS NULL
           AND t.parent_task_id IS NULL AND NOT t.completed
           AND t.due_on IS NOT NULL AND ${dueCondition}
         LIMIT 150`,
        [rule.project_id, days],
      );
      for (const task of tasks.rows) {
        const fireKey = `${trigger.event}:${days}:${task.id}:${task.due_on}`;
        const claimed = await db.query(
          `INSERT INTO automation_fires (rule_id, fire_key, subject_type, subject_id)
           VALUES ($1::bigint, $2, 'task', $3::bigint)
           ON CONFLICT (rule_id, fire_key) DO NOTHING
           RETURNING rule_id`,
          [rule.id, fireKey, task.id],
        );
        if (claimed.rowCount === 0) continue;
        await emitDomainEvent({
          workspaceId: rule.workspace_id,
          projectId: rule.project_id,
          actorId: rule.owner_id,
          type: trigger.event,
          subjectType: "task",
          subjectId: Number(task.id),
          data: {
            target_rule_id: rule.id,
            days,
            due_on: task.due_on,
            fire_key: fireKey,
          },
          correlationId: `schedule:${rule.id}:${task.id}:${fireKey}`,
        });
        emitted += 1;
      }
    }
  }
  return emitted;
}

/** Process pending events; safe for multiple workers via SKIP LOCKED claims. */
export async function processPendingEvents(limit = MAX_EVENTS_PER_TICK, forceScheduled = false): Promise<{
  processed: number;
  scheduled: number;
}> {
  let processed = 0;
  const now = Date.now();
  let scheduled = 0;
  if (forceScheduled || now - lastScheduleScan > 60_000) {
    lastScheduleScan = now;
    scheduled = await processScheduledTriggers();
  }
  for (let index = 0; index < limit; index += 1) {
    const event = await claimEvent();
    if (!event) break;
    try {
      await processEvent(event);
      processed += 1;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      await db.query(
        `UPDATE domain_events
         SET processing_at = NULL, last_error = $2,
           failed_at = CASE WHEN attempts >= 5 THEN now() ELSE failed_at END
         WHERE id = $1`,
        [event.id, message],
      );
      break;
    }
  }
  return { processed, scheduled };
}
