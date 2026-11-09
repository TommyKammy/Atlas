import { db, withTransaction } from "./db";

/**
 * Assign sequential auto-ID values to every project task that does not have
 * one yet. Called lazily when project custom values are loaded, so tasks
 * created through any path (API, import, template, subtask) get an ID.
 * The transaction-wide advisory lock keeps concurrent requests from handing
 * out the same number.
 */
export async function ensureAutoIdValues(projectId: number): Promise<void> {
  const existing = await db.query(
    "SELECT 1 FROM custom_fields WHERE project_id = $1::bigint AND field_type = 'auto_id' AND deleted_at IS NULL LIMIT 1",
    [projectId],
  );
  if (existing.rowCount === 0) return;
  await withTransaction(async (q) => {
    const fields = await q.query(
      "SELECT id, config FROM custom_fields WHERE project_id = $1::bigint AND field_type = 'auto_id' AND deleted_at IS NULL ORDER BY id",
      [projectId],
    );
    for (const field of fields.rows) {
      const fieldId = Number(field.id);
      const rawPrefix = field.config?.prefix;
      const prefix = typeof rawPrefix === "string" && rawPrefix.trim() !== "" ? rawPrefix.trim().slice(0, 16) : "ID-";
      await q.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`atlas-auto-id:${fieldId}`]);
      const max = await q.query(
        "SELECT COALESCE(MAX(value_number), 0)::int AS max FROM task_custom_values WHERE field_id = $1::bigint",
        [fieldId],
      );
      const base = Number(max.rows[0]?.max ?? 0);
      await q.query(
        `INSERT INTO task_custom_values (task_id, field_id, value_number, value_text)
         SELECT t.id, $2::bigint,
           $3::int + row_number() OVER (ORDER BY t.position, t.id),
           $4::text || ($3::int + row_number() OVER (ORDER BY t.position, t.id))::text
         FROM tasks t
         WHERE (t.project_id = $1::bigint OR EXISTS (
             SELECT 1 FROM task_project_memberships m
             WHERE m.task_id = t.id AND m.project_id = $1::bigint
           ))
           AND t.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM task_custom_values v
             WHERE v.task_id = t.id AND v.field_id = $2::bigint
           )
         ON CONFLICT (task_id, field_id) DO NOTHING`,
        [projectId, fieldId, base, prefix],
      );
    }
  });
}
