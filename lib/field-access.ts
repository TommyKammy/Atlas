import { db } from "./db";
import { normalizeAccessLevel } from "./custom-fields";

/** Enforce a custom field's edit-access policy for the current user. */
export async function canEditFieldValue(
  userId: number,
  projectId: number,
  field: { access_level?: string | null; editor_ids?: unknown },
): Promise<boolean> {
  const level = normalizeAccessLevel(field.access_level);
  if (level === "everyone") return true;
  const access = await db.query(
    `SELECT u.is_admin, m.role
     FROM users u LEFT JOIN project_members m ON m.project_id = $2::bigint AND m.user_id = u.id
     WHERE u.id = $1::bigint`,
    [userId, projectId],
  );
  const isAdmin = access.rows[0]?.is_admin === true || access.rows[0]?.role === "admin";
  if (level === "admins") return isAdmin;
  const editors = Array.isArray(field.editor_ids) ? field.editor_ids.map(Number) : [];
  return isAdmin || editors.includes(userId);
}
