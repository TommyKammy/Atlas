import { db, type Queryable } from "../db";
import { canEditFieldValue } from "../field-access";
import { canEditProject } from "../project-roles";
import { getProjectAccess } from "../repositories/projects";
import { normalizeTaskCustomValue } from "../task-custom-value";
import { configuredTaskId } from "./task-target";
import type { RuleDefinition } from "./types";

function containsTemplate(value: unknown): boolean {
  return (typeof value === "string" && /\{\{[^}]+\}\}/.test(value)) ||
    (Array.isArray(value) && value.some(containsTemplate));
}

/** Validate editor literals now; rendered template values are checked again at execution. */
export async function validateRuleCustomFieldActions(
  definition: RuleDefinition,
  userId: number,
  q: Queryable = db,
): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 403 }> {
  const actions = [...(definition.actions ?? []), ...(definition.branches ?? []).flatMap((branch) => branch.actions)];
  for (const action of actions) {
    if (action.capability !== "task.set_custom_field") continue;
    const id = configuredTaskId(action.params.field_id);
    if (!id) return { ok: false, error: "field_id must be a positive integer", status: 400 };
    const field = await q.query(
      `SELECT field_type, project_id, config, access_level, editor_ids FROM custom_fields
       WHERE id = $1::bigint AND deleted_at IS NULL`, [id],
    );
    if (field.rowCount === 0) return { ok: false, error: "custom field not found", status: 400 };
    const row = field.rows[0];
    const access = await getProjectAccess(userId, Number(row.project_id), q);
    if (!canEditProject(access.role) || !(await canEditFieldValue(userId, Number(row.project_id), row, q))) {
      return { ok: false, error: "field access denied", status: 403 };
    }
    const writable = await normalizeTaskCustomValue(row, null, userId, q);
    if (!writable.ok) return writable;
    const value = action.params.value;
    if (!containsTemplate(value)) {
      const normalized = await normalizeTaskCustomValue(row, value, userId, q);
      if (!normalized.ok) return normalized;
    }
  }
  return { ok: true };
}
