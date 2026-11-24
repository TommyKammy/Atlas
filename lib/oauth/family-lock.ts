import type { Queryable } from "@/lib/db";

/**
 * Serialize writes that can add or revoke rows in one OAuth token family.
 *
 * Refresh rotation inserts a new token pair with the same family_id while a
 * family revocation runs `UPDATE ... WHERE family_id = ...`. Under READ
 * COMMITTED the revocation's UPDATE does not see rows inserted after its
 * snapshot, so a rotated pair could survive. Both sides take this
 * transaction-scoped advisory lock first, which makes them serialize; the lock
 * is re-entrant within a transaction and released on COMMIT/ROLLBACK.
 *
 * Lock order everywhere: users row -> OAuth family advisory lock -> token rows.
 */
export async function lockOAuthFamily(q: Queryable, familyId: string): Promise<void> {
  await q.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('atlas:oauth_family:' || $1::text, 0))",
    [familyId],
  );
}
