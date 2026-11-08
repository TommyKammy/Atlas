import { db } from "./db";
import {
  isLookupTargetFieldType,
  type CustomFieldConfig,
  type CustomFieldType,
} from "./custom-fields";

/**
 * Validate cross-field references for reference/lookup/rollup configs.
 * Returns a user-facing error, or null when valid.
 */
export async function validateCustomFieldReferences(
  projectId: number,
  fieldType: CustomFieldType,
  config: CustomFieldConfig,
  userId?: number,
): Promise<string | null> {
  if (fieldType === "reference") {
    const ids = config.source_project_ids ?? [];
    if (ids.length === 0) return "source_project_ids is required";
    const projects = await db.query(
      "SELECT id FROM projects WHERE id = ANY($1::bigint[])",
      [ids],
    );
    if (projects.rowCount !== new Set(ids).size) return "source project not found";
    if (userId !== undefined) {
      const access = await db.query(
        `SELECT p.id FROM projects p
         WHERE p.id = ANY($1::bigint[])
           AND (
             EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
             OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)
           )`,
        [ids, userId],
      );
      if (access.rowCount !== new Set(ids).size) return "source project not accessible";
    }
    return null;
  }

  if (fieldType === "lookup") {
    const refId = config.reference_field_id;
    const targetId = config.lookup_field_id;
    if (!refId || !targetId) return "reference_field_id and lookup_field_id are required";
    const ref = await db.query(
      "SELECT project_id, field_type FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
      [refId],
    );
    if (ref.rowCount === 0 || Number(ref.rows[0].project_id) !== projectId || ref.rows[0].field_type !== "reference") {
      return "reference field must belong to this project";
    }
    const target = await db.query(
      "SELECT field_type FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
      [targetId],
    );
    if (target.rowCount === 0) return "lookup field not found";
    if (!isLookupTargetFieldType(target.rows[0].field_type)) {
      return "lookup field type is not supported";
    }
    return null;
  }

  if (fieldType === "rollup") {
    const targetId = config.rollup_field_id;
    if (!targetId) return "rollup_field_id is required";
    if (config.rollup_source === "reference") {
      const refId = config.reference_field_id;
      if (!refId) return "reference_field_id is required";
      const ref = await db.query(
        "SELECT project_id, field_type FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
        [refId],
      );
      if (ref.rowCount === 0 || Number(ref.rows[0].project_id) !== projectId || ref.rows[0].field_type !== "reference") {
        return "reference field must belong to this project";
      }
    }
    const target = await db.query(
      "SELECT field_type FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
      [targetId],
    );
    if (target.rowCount === 0) return "rollup field not found";
    if (target.rows[0].field_type !== "number") return "rollup field must be numeric";
    return null;
  }

  return null;
}
