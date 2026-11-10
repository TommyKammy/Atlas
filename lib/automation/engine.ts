import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DomainEventRow } from "../domain/events";
import { STALE_AUTOMATION_SUBJECT } from "../repositories/task-rule-snapshot";
import {
  AutomationClaimLost,
  MAX_PROCESSING_FAILURES,
  failInterruptedAutomationEvent,
  finishAutomationEvent,
  retryAutomationEvent,
  withAutomationClaim,
  type AutomationClaim,
} from "./lease";
import { executeAutomationPlan, RULE_SUBJECT_SCOPE_VERSION } from "./execution";
import { getExecutableProjectRules } from "./repository";
import { processScheduledTriggers } from "./scheduled";
import { evaluateRule, historyRuleEvaluation, ruleTriggersMatch } from "./evaluation";
import { loadRuleSnapshot } from "./snapshot";
import { automationLineage } from "./causation";
import { RULE_LIMITS } from "./types";
import { PROJECT_AUTOMATION_SHARED_LOCK_SQL } from "../project-automation-lock";

const MAX_EVENTS_PER_TICK = 20;
let lastScheduleScan = 0;

type ClaimedEvent = DomainEventRow & AutomationClaim & {
  planReady: boolean;
  processingFailures: number;
};

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
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    attempts: Number(row.attempts ?? 0),
  };
}

async function claimEvent(eventId?: number): Promise<ClaimedEvent | null> {
  const claimToken = randomUUID();
  const r = await db.query(
    `WITH project_automation_guard AS MATERIALIZED (
       ${PROJECT_AUTOMATION_SHARED_LOCK_SQL}
     ), candidate AS (
       SELECT e.id FROM domain_events e CROSS JOIN project_automation_guard
       WHERE processed_at IS NULL AND failed_at IS NULL
         AND ($2::bigint IS NULL OR id = $2::bigint)
         AND (retry_at IS NULL OR retry_at <= clock_timestamp())
         AND (claim_token IS NULL OR lease_expires_at <= clock_timestamp())
       ORDER BY id
       LIMIT 1
       FOR UPDATE OF e SKIP LOCKED
     )
     UPDATE domain_events e
     SET processing_at = now(), attempts = attempts + 1,
         processing_failures = processing_failures + CASE WHEN claim_token IS NULL THEN 0 ELSE 1 END,
         claim_token = $1::uuid, lease_expires_at = clock_timestamp() + interval '5 minutes',
         retry_at = NULL
     FROM candidate c
     WHERE e.id = c.id
     RETURNING e.*`,
    [claimToken, eventId ?? null],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    ...eventRow(row),
    claimToken,
    planReady: row.automation_plan_ready === true,
    processingFailures: Number(row.processing_failures),
  };
}

async function processEvent(event: ClaimedEvent): Promise<boolean> {
  if (event.processingFailures >= MAX_PROCESSING_FAILURES) {
    await withAutomationClaim(event, (q) =>
      failInterruptedAutomationEvent(q, event.id, "automation repeatedly lost its processing lease"));
    return true;
  }
  if (event.chain_depth > RULE_LIMITS.chainDepth || event.project_id === null) {
    await withAutomationClaim(event, async (q) => {
      await finishAutomationEvent(q, event.id, null);
      if (event.chain_depth > RULE_LIMITS.chainDepth) {
        await q.query("UPDATE domain_events SET last_error = $2 WHERE id = $1",
          [event.id, `chain depth exceeded (${event.chain_depth})`]);
      }
    });
    return true;
  }

  const projectId = event.project_id;
  if (!event.planReady) {
    const planned = await withAutomationClaim(event, async (q) => {
      const rules = (await getExecutableProjectRules(projectId, q))
        .filter((rule) => rule.enabled && ruleTriggersMatch(rule.definition, event, rule.id));
      if (rules.length === 0) {
        await finishAutomationEvent(q, event.id, null);
        return false;
      }
      const lineage = await automationLineage(q, event.id);
      if (!lineage) throw new Error("automation causation not found");
      const eligibleRules = rules.filter((rule) => !lineage.ruleIds.includes(rule.id));
      if (eligibleRules.length === 0) {
        await finishAutomationEvent(q, event.id, null);
        return false;
      }
      const snapshot = await loadRuleSnapshot(event, q);
      if (!snapshot) {
        await finishAutomationEvent(q, event.id, STALE_AUTOMATION_SUBJECT);
        return false;
      }
      for (const rule of eligibleRules) {
        const evaluation = evaluateRule(rule.definition, snapshot, rule.id);
        if (!evaluation.trace.matched) continue;
        const rendered = evaluation.actions.map((action) => ({ ...action, subjectScopeVersion: RULE_SUBJECT_SCOPE_VERSION }));
        await q.query(
          `INSERT INTO automation_rule_executions
             (event_id, rule_id, rule_version, rule_name, owner_id, actions, planned_attempt,
              event_actor_id, event_causation_id, delivery_seed, evaluation)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::uuid, $11::jsonb)`,
          [event.id, rule.id, rule.version, rule.name, rule.owner_id, JSON.stringify(rendered),
            event.attempts, event.actor_id, event.causation_id, randomUUID(), JSON.stringify(historyRuleEvaluation(evaluation.trace))],
        );
      }
      await q.query("UPDATE domain_events SET automation_plan_ready = TRUE WHERE id = $1", [event.id]);
      return true;
    });
    if (!planned) return true;
  }
  return executeAutomationPlan({ ...event, project_id: projectId });
}

async function processClaimedEvent(event: ClaimedEvent): Promise<boolean> {
  try {
    return await processEvent(event);
  } catch (caught) {
    if (caught instanceof AutomationClaimLost) return false;
    const message = (caught instanceof Error ? caught.message : String(caught)).slice(0, 1000);
    try {
      await withAutomationClaim(event, async (q) => {
        const current = await q.query("SELECT processing_failures FROM domain_events WHERE id = $1", [event.id]);
        const failures = Number(current.rows[0].processing_failures) + 1;
        if (failures >= MAX_PROCESSING_FAILURES) {
          await failInterruptedAutomationEvent(q, event.id, message);
        } else {
          await retryAutomationEvent(q, event.id, failures, message, failures);
        }
      });
    } catch (error) {
      if (!(error instanceof AutomationClaimLost)) throw error;
    }
    return false;
  }
}

/** Claim only the newly requested event. Background work keeps FIFO processing. */
export async function processAutomationEvent(eventId: number): Promise<void> {
  const event = await claimEvent(eventId);
  if (event) await processClaimedEvent(event);
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
    scheduled = await processScheduledTriggers(db, new Date(now));
    lastScheduleScan = now;
  }
  for (let index = 0; index < limit; index += 1) {
    const event = await claimEvent();
    if (!event) break;
    if (await processClaimedEvent(event)) processed += 1;
  }
  return { processed, scheduled };
}
