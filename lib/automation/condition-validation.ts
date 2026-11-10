import { db, type Queryable } from "../db";
import { customConditionType, validConditionValue } from "./condition-schema";
import type { RuleDefinition } from "./types";

/** Resolve project-specific fields after the structural validator, before saving. */
export async function validateRuleConditionScope(
  definition: RuleDefinition,
  scope: { projectId: number } | { portfolioId: number },
  viewerId: number,
  q: Queryable = db,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const conditions = [...(definition.conditions ?? []), ...(definition.branches ?? []).flatMap((branch) => branch.conditions)];
  const custom = conditions.filter((condition) => condition.field.startsWith("custom."));
  if (custom.length === 0) return { ok: true };
  const projectScope = "projectId" in scope;
  const fields = await q.query(
    `SELECT f.id, f.name, f.field_type FROM custom_fields f
     JOIN projects p ON p.id = f.project_id
     WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL
       AND ${projectScope ? "f.project_id = $1::bigint" : "EXISTS (SELECT 1 FROM portfolio_items i WHERE i.portfolio_id = $1::bigint AND i.project_id = p.id)"}
       AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $2::bigint AND u.is_admin AND u.deactivated_at IS NULL)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2::bigint))`,
    [projectScope ? scope.projectId : scope.portfolioId, viewerId],
  );
  for (const condition of custom) {
    const key = condition.field.slice(7);
    const matches = fields.rows.filter((field) => String(field.id) === key || field.name === key);
    if (matches.length === 0) return { ok: false, error: `unknown condition field: ${condition.field}` };
    if (matches.some((field) => !validConditionValue(condition, customConditionType(String(field.field_type))))) {
      return { ok: false, error: `invalid condition operator or value for ${condition.field}` };
    }
  }
  return { ok: true };
}
