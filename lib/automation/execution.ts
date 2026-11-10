import type { Queryable } from "../db";
import type { DomainEventRow } from "../domain/events";
import { executeCapability, type CapabilityContext, type CapabilityResult } from "../capabilities";
import { notifyProject } from "../notify";
import { canEditProject } from "../project-roles";
import { getProjectAccess } from "../repositories/projects";
import { lockRuleSubject, STALE_AUTOMATION_SUBJECT } from "../repositories/task-rule-snapshot";
import { finishAutomationEvent, retryAutomationEvent, withAutomationClaim, type AutomationClaim } from "./lease";
import { recordRuleRun } from "./repository";
import { RULE_LIMITS, type RuleAction, type RuleRunActionDetail } from "./types";
import { automationLineage } from "./causation";
import { redactWebhookRun } from "./webhook-credentials";
import { automationWebhookDelivery } from "./webhook-signature";
import type { RuleEvaluationTrace } from "./evaluation";

type ExecutionEvent = DomainEventRow & AutomationClaim & { project_id: number };

// Pending plans from before scoped snapshots may contain rendered private values.
export const RULE_SUBJECT_SCOPE_VERSION = 1;

type Execution = {
  rule_id: number;
  rule_version: number;
  rule_name: string;
  owner_id: number | null;
  actions: (RuleAction & { subjectScopeVersion?: number })[];
  planned_at: Date;
  planned_attempt: number;
  event_actor_id: number | null;
  event_causation_id: number | null;
  delivery_seed: string;
  next_action: number;
  action_attempts: number;
  budgeted_action: number;
  details: RuleRunActionDetail[];
  evaluation: RuleEvaluationTrace | null;
};

type CurrentRule = { id: number; owner_id: number | null; version: number; enabled: boolean };

type Step = "advance" | "deferred" | "finished";
type WebhookStep = {
  execution: Execution;
  rule: CurrentRule;
  action: RuleAction;
  attempts: number;
};

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function isRetryable(error: unknown, message: string): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code.startsWith("08") || ["40001", "40P01", "55P03", "57014", "57P01", "53300"].includes(code);
  }
  const webhookStatus = /^webhook returned ([0-9]{3})$/.exec(message);
  if (webhookStatus) {
    const status = Number(webhookStatus[1]);
    return status === 408 || status === 429 || status >= 500;
  }
  return !/(access|denied|permission|required|invalid|not found|does not belong|already belongs|unknown capability)/i.test(message);
}

function maxAttempts(): number {
  const configured = Number(process.env.AUTOMATION_ACTION_MAX_ATTEMPTS ?? 3);
  return Number.isFinite(configured) ? Math.max(1, Math.min(5, Math.trunc(configured))) : 3;
}

function capabilityContext(event: ExecutionEvent, execution: Execution, actorId: number): CapabilityContext {
  return {
    actorId,
    source: "automation",
    projectId: event.project_id,
    correlationId: event.correlation_id ?? `event:${event.id}`,
    eventId: event.id,
    chainDepth: event.chain_depth,
    ruleId: execution.rule_id,
    // Do not include mutable lease credentials in a capability or an external payload.
    event: {
      id: event.id,
      workspace_id: event.workspace_id,
      project_id: event.project_id,
      actor_id: execution.event_actor_id,
      type: event.type,
      version: event.version,
      subject_type: event.subject_type,
      subject_id: event.subject_id,
      data: event.data,
      correlation_id: event.correlation_id,
      causation_id: execution.event_causation_id,
      chain_depth: event.chain_depth,
      occurred_at: event.occurred_at,
      attempts: execution.planned_attempt,
    },
  };
}

async function getRule(q: Queryable, event: ExecutionEvent, ruleId: number): Promise<CurrentRule | null> {
  const r = await q.query(
    "SELECT id, owner_id, version, enabled FROM project_rules WHERE id = $1 AND project_id = $2 FOR SHARE",
    [ruleId, event.project_id],
  );
  return r.rows[0] ?? null;
}

async function finishExecution(
  q: Queryable,
  eventId: number,
  execution: Execution,
  rule: CurrentRule | null,
  details: RuleRunActionDetail[],
  error: string | null,
  nextAction = execution.next_action,
): Promise<void> {
  const status = error ? "failed" : "success";
  // Old pending plans may also have unscoped rendered values in prior action
  // details. Keep their outcomes without copying those values into history.
  const history = execution.actions.every((action) => action.subjectScopeVersion === RULE_SUBJECT_SCOPE_VERSION)
    ? details
    : details.map(({ index, capability, status, attempts }) => ({ index, capability, status, attempts, params: {} }));
  await recordRuleRun({
    rule: {
      id: rule?.id ?? null,
      owner_id: rule?.owner_id === execution.owner_id ? execution.owner_id : null,
      name: execution.rule_name,
      version: execution.rule_version,
    },
    eventId,
    source: "automation",
    status,
    details: history,
    plannedActions: execution.actions.length,
    evaluation: execution.evaluation ?? undefined,
    error,
  }, q);
  await q.query(
    `UPDATE automation_rule_executions
     SET status = $3, error = $4, details = $5::jsonb, next_action = $6,
         actions = '[]'::jsonb, action_attempts = 0
     WHERE event_id = $1 AND rule_id = $2`,
    [eventId, execution.rule_id, status, error, JSON.stringify(history), nextAction],
  );
}

async function completeAction(
  q: Queryable,
  eventId: number,
  execution: Execution,
  rule: CurrentRule | null,
  action: RuleAction,
  attempts: number,
  result: CapabilityResult,
): Promise<"advance"> {
  const detail: RuleRunActionDetail = {
    index: execution.next_action,
    capability: action.capability,
    params: action.params,
    status: "success",
    attempts,
    result: result.data ?? { summary: result.summary },
  };
  const details = [...execution.details, ...redactWebhookRun({ details: [detail] }).details];
  const nextAction = execution.next_action + 1;
  if (nextAction === execution.actions.length) {
    await finishExecution(q, eventId, execution, rule, details, null, nextAction);
  } else {
    await q.query(
      `UPDATE automation_rule_executions SET next_action = $3, action_attempts = 0, details = $4::jsonb, error = NULL
       WHERE event_id = $1 AND rule_id = $2`,
      [eventId, execution.rule_id, nextAction, JSON.stringify(details)],
    );
  }
  await q.query("UPDATE domain_events SET processing_failures = 0 WHERE id = $1 AND processing_failures <> 0", [eventId]);
  return "advance";
}

async function failAction(
  q: Queryable,
  eventId: number,
  execution: Execution,
  rule: CurrentRule | null,
  action: RuleAction,
  attempts: number,
  error: unknown,
): Promise<"deferred" | "advance"> {
  const message = errorMessage(error);
  const detail: RuleRunActionDetail = {
    index: execution.next_action,
    capability: action.capability,
    params: action.params,
    status: "failed",
    attempts,
    error: message,
  };
  const history = redactWebhookRun({ details: [detail], error: message });
  if (attempts < maxAttempts() && isRetryable(error, message)) {
    await q.query(
      `UPDATE automation_rule_executions SET action_attempts = $3, error = $4
       WHERE event_id = $1 AND rule_id = $2`,
      [eventId, execution.rule_id, attempts, history.error],
    );
    await retryAutomationEvent(q, eventId, attempts, history.error);
    return "deferred";
  }
  await finishExecution(q, eventId, execution, rule, [...execution.details, ...history.details], history.error);
  return "advance";
}

async function executeNext(
  q: Queryable,
  event: ExecutionEvent,
  notifyAfterCommit: (id: number) => void,
): Promise<Step | WebhookStep> {
  const pending = await q.query(
    `SELECT * FROM automation_rule_executions WHERE event_id = $1 AND status = 'pending'
     ORDER BY rule_id LIMIT 1`,
    [event.id],
  );
  const execution: Execution | undefined = pending.rows[0];
  if (!execution) {
    const failed = await q.query(
      `SELECT error FROM automation_rule_executions WHERE event_id = $1 AND status = 'failed'
       ORDER BY rule_id LIMIT 1`,
      [event.id],
    );
    await finishAutomationEvent(q, event.id, failed.rows[0]?.error ?? null);
    return "finished";
  }

  const rule = await getRule(q, event, execution.rule_id);
  const owner = execution.owner_id;
  if (!rule?.enabled || rule.version !== execution.rule_version || rule.owner_id !== owner) {
    await finishExecution(q, event.id, execution, rule, execution.details, "rule changed during automation execution");
    return "advance";
  }
  const action = execution.actions[execution.next_action];
  if (!action) throw new Error("automation checkpoint has no action");
  const lineage = await automationLineage(q, event.id);
  if (!lineage || lineage.ruleIds.includes(execution.rule_id)) {
    await finishExecution(q, event.id, execution, rule, execution.details, "automation causal rule cycle denied");
    return "advance";
  }
  // Take the root lock before any subject lock. All branches share one budget.
  const root = await q.query("SELECT id FROM domain_events WHERE id = $1 FOR UPDATE", [lineage.rootEventId]);
  if (root.rowCount === 0) {
    await finishExecution(q, event.id, execution, rule, execution.details, "automation causal root not found");
    return "advance";
  }
  if (!(await lockRuleSubject(q, event, { updatesProject: action.capability === "project.set_status" }))) {
    await finishExecution(q, event.id, execution, rule, execution.details, STALE_AUTOMATION_SUBJECT);
    return "advance";
  }
  if (action.subjectScopeVersion !== RULE_SUBJECT_SCOPE_VERSION) {
    await finishExecution(q, event.id, execution, rule, execution.details, "automation plan predates project scope validation");
    return "advance";
  }
  if (owner === null || !canEditProject((await getProjectAccess(owner, event.project_id, q)).role)) {
    await finishExecution(
      q, event.id, execution, rule, execution.details, "rule owner does not have edit access to the source project",
    );
    return "advance";
  }
  if (execution.budgeted_action !== execution.next_action) {
    const reserved = await q.query(
      `UPDATE domain_events SET automation_actions_started = automation_actions_started + 1
       WHERE id = $1 AND automation_actions_started < $2 RETURNING id`,
      [lineage.rootEventId, RULE_LIMITS.maxActionTargets],
    );
    if (reserved.rowCount === 0) {
      await finishExecution(q, event.id, execution, rule, execution.details, "automation causal action limit exceeded");
      return "advance";
    }
    await q.query(
      "UPDATE automation_rule_executions SET budgeted_action = $3 WHERE event_id = $1 AND rule_id = $2",
      [event.id, execution.rule_id, execution.next_action],
    );
  }
  const attempts = execution.action_attempts + 1;
  if (action.capability === "webhook.post") {
    if (attempts > maxAttempts()) {
      return failAction(q, event.id, execution, rule, action, execution.action_attempts,
        new Error("webhook delivery outcome is unknown after the last attempt"));
    }
    await q.query(
      `UPDATE automation_rule_executions SET action_attempts = $3 WHERE event_id = $1 AND rule_id = $2`,
      [event.id, execution.rule_id, attempts],
    );
    return { execution, rule, action, attempts };
  }

  await q.query("SAVEPOINT automation_action");
  const actionNotifications = new Set<number>();
  let result: CapabilityResult;
  try {
    result = await executeCapability(action.capability, action.params, {
      ...capabilityContext(event, execution, owner),
      q,
      notifyAfterCommit: (id) => actionNotifications.add(id),
    });
  } catch (error) {
    await q.query("ROLLBACK TO SAVEPOINT automation_action");
    await q.query("RELEASE SAVEPOINT automation_action");
    return failAction(q, event.id, execution, rule, action, attempts, error);
  }
  await q.query("RELEASE SAVEPOINT automation_action");
  const outcome = await completeAction(q, event.id, execution, rule, action, attempts, result);
  for (const id of actionNotifications) notifyAfterCommit(id);
  return outcome;
}

async function deliverWebhook(event: ExecutionEvent, step: WebhookStep): Promise<Step> {
  const { execution, rule, action, attempts } = step;
  let outcome: { result: CapabilityResult } | { error: unknown };
  try {
    const result = await executeCapability(action.capability, action.params, {
      ...capabilityContext(event, execution, rule.owner_id!),
      webhookDelivery: automationWebhookDelivery(
        execution.delivery_seed, execution.next_action, execution.planned_at,
      ),
    });
    outcome = { result };
  } catch (error) {
    outcome = { error };
  }
  return withAutomationClaim(event, async (q) => {
    const currentRule = await getRule(q, event, execution.rule_id);
    if ("result" in outcome) {
      return completeAction(q, event.id, execution, currentRule, action, attempts, outcome.result);
    }
    return failAction(q, event.id, execution, currentRule, action, attempts, outcome.error);
  });
}

export async function executeAutomationPlan(event: ExecutionEvent): Promise<boolean> {
  for (;;) {
    const notifications = new Set<number>();
    const step = await withAutomationClaim(event, (q) => executeNext(q, event, (id) => notifications.add(id)));
    const outcome = typeof step === "string" ? step : await deliverWebhook(event, step);
    if (outcome === "finished") return true;
    if (outcome === "deferred") return false;
    await Promise.all([...notifications].map((id) => notifyProject(id)));
  }
}
