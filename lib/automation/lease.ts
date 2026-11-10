import { withTransaction, type Queryable } from "../db";
import { lockAutomationProjectAccess } from "../project-automation-lock";

export const MAX_PROCESSING_FAILURES = 5;

export type AutomationClaim = {
  id: number;
  claimToken: string;
};

export class AutomationClaimLost extends Error {
  constructor() {
    super("automation claim is no longer active");
  }
}

/** Lock the claimed event and extend its lease before any durable write. */
export function withAutomationClaim<T>(
  claim: AutomationClaim,
  operation: (q: Queryable) => Promise<T>,
): Promise<T> {
  return withTransaction(async (q) => {
    await q.query("SET LOCAL statement_timeout = '30s'");
    await q.query("SET LOCAL lock_timeout = '5s'");
    await lockAutomationProjectAccess(q);
    const leased = await q.query(
      `UPDATE domain_events SET lease_expires_at = clock_timestamp() + interval '5 minutes'
       WHERE id = $1 AND claim_token = $2::uuid AND lease_expires_at > clock_timestamp()
         AND processed_at IS NULL AND failed_at IS NULL`,
      [claim.id, claim.claimToken],
    );
    if (leased.rowCount !== 1) throw new AutomationClaimLost();
    return operation(q);
  });
}

/** Delay a retry without blocking another event. The caller holds the fenced row lock. */
export async function retryAutomationEvent(
  q: Queryable,
  eventId: number,
  attempts: number,
  error: string,
  processingFailures = 0,
): Promise<void> {
  await q.query(
    `UPDATE domain_events
     SET claim_token = NULL, lease_expires_at = NULL, processing_at = NULL,
         retry_at = clock_timestamp() + $2::integer * interval '1 millisecond',
         processing_failures = $4, last_error = $3
     WHERE id = $1`,
    [eventId, 250 * 2 ** Math.min(attempts - 1, 5), error, processingFailures],
  );
}

/** The caller holds the fenced row lock. */
export async function finishAutomationEvent(
  q: Queryable,
  eventId: number,
  error: string | null,
): Promise<void> {
  await q.query(
    `UPDATE domain_events
     SET claim_token = NULL, lease_expires_at = NULL, processing_at = NULL, retry_at = NULL,
         processed_at = CASE WHEN $2::text IS NULL THEN now() ELSE NULL END,
         failed_at = CASE WHEN $2::text IS NOT NULL THEN now() ELSE NULL END,
         last_error = $2
     WHERE id = $1`,
    [eventId, error],
  );
}

export async function failInterruptedAutomationEvent(
  q: Queryable,
  eventId: number,
  error: string,
): Promise<void> {
  await q.query(
    `UPDATE automation_rule_executions SET actions = '[]'::jsonb, status = 'failed', error = $2
     WHERE event_id = $1 AND status = 'pending'`,
    [eventId, error],
  );
  await finishAutomationEvent(q, eventId, error);
}
