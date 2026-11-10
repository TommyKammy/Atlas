import type { Queryable } from "./db";

// A dedicated two-int advisory key, separate from the existing bigint locks.
// Workers share this gate; project deletion takes it exclusively before any
// task/project/event row lock. This also covers cross-project task homes and
// causal roots without guessing which projects a pending action may touch.
export const PROJECT_AUTOMATION_SHARED_LOCK_SQL =
  "SELECT pg_advisory_xact_lock_shared(1096043603, 2)";
export const PROJECT_DELETION_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(1096043603, 2)";

/** Use inside a transaction, before the automation stage takes row locks. */
export async function lockAutomationProjectAccess(q: Queryable): Promise<void> {
  await q.query(PROJECT_AUTOMATION_SHARED_LOCK_SQL);
}

/** Use inside the project mutation transaction, before detaching task homes. */
export async function lockProjectDeletion(q: Queryable): Promise<void> {
  await q.query(PROJECT_DELETION_LOCK_SQL);
}
