import { queryAtRequestBoundary } from "./db";

/**
 * Record a search query at the request boundary (Proxy). This keeps write
 * side effects out of the /search Server Component render path while still
 * persisting direct /search?q=... visits.
 */
export async function recordSearchHistoryAtBoundary(userId: number, query: string): Promise<void> {
  const q = query.trim().slice(0, 200);
  if (q === "") return;
  await queryAtRequestBoundary(
    `INSERT INTO search_history (user_id, query, created_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, query) DO UPDATE SET created_at = now()`,
    [userId, q],
  );
  await queryAtRequestBoundary(
    `DELETE FROM search_history
     WHERE user_id = $1 AND query NOT IN (
       SELECT query FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
     )`,
    [userId],
  );
}
