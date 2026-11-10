import { db, type Queryable } from "./db";
import { canEditCustomField, normalizeAccessLevel } from "./custom-fields";

export function normalizeFieldEditorIds(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
    : [];
}

/** Enforce a custom field's edit-access policy for the current user. */
export async function canEditFieldValue(
  userId: number,
  projectId: number,
  field: { access_level?: string | null; editor_ids?: unknown },
  q: Queryable = db,
): Promise<boolean> {
  const level = normalizeAccessLevel(field.access_level);
  if (level === "everyone") return true;
  const access = await q.query(
    `SELECT u.is_admin, m.role
     FROM users u LEFT JOIN project_members m ON m.project_id = $2::bigint AND m.user_id = u.id
     WHERE u.id = $1::bigint`,
    [userId, projectId],
  );
  const isAdmin = access.rows[0]?.is_admin === true || access.rows[0]?.role === "admin";
  return canEditCustomField(
    { access_level: level, editor_ids: normalizeFieldEditorIds(field.editor_ids) },
    { viewerId: userId, canEdit: true, canAdmin: isAdmin },
  );
}
