import { db, type Queryable } from "../db";
import { canEditFieldValue } from "../field-access";
import { projectTaskScope } from "../repositories/scope";
import { taskRuleScopeSql } from "../repositories/task-rule-snapshot";
import type { RuleEditorOption, RuleOptionQuery } from "./no-code-inputs";

type OptionResult =
  | { ok: true; options: RuleEditorOption[]; hasMore: boolean }
  | { ok: false; error: string; status: 403 | 404 };

/** Every search and saved-ID lookup applies the same live permission predicate. */
export async function searchRuleOptions(
  projectId: number,
  userId: number,
  input: RuleOptionQuery,
  q: Queryable = db,
): Promise<OptionResult> {
  const { kind, query, ids } = input;
  let statement: string;
  const params: unknown[] = [query, projectId, ids];
  if (kind === "task") {
    statement = `SELECT t.id AS value, t.name AS label,
        CASE WHEN t.parent_task_id IS NULL THEN 'タスク' ELSE 'サブタスク' END AS description
      ${taskRuleScopeSql({ singleTask: false, lock: false })}
        AND ($1 = '' OR strpos(lower(t.name), lower($1)) > 0)
        AND (cardinality($3::bigint[]) = 0 OR t.id = ANY($3::bigint[]))`;
  } else if (kind === "section") {
    statement = `SELECT id AS value, name AS label FROM sections
      WHERE project_id = $2::bigint AND ($1 = '' OR strpos(lower(name), lower($1)) > 0)
        AND (cardinality($3::bigint[]) = 0 OR id = ANY($3::bigint[]))`;
  } else if (kind === "user") {
    statement = `SELECT id AS value, name AS label FROM users
      WHERE deactivated_at IS NULL AND $2::bigint IS NOT NULL
        AND ($1 = '' OR strpos(lower(name), lower($1)) > 0)
        AND (cardinality($3::bigint[]) = 0 OR id = ANY($3::bigint[]))`;
  } else if (kind === "project") {
    params.push(userId);
    statement = `SELECT p.id AS value, p.name AS label FROM projects p
      WHERE p.deleted_at IS NULL AND p.archived_at IS NULL AND $2::bigint IS NOT NULL
        AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $4::bigint AND u.is_admin AND u.deactivated_at IS NULL)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $4::bigint AND m.role IN ('admin','editor','member')))
        AND ($1 = '' OR strpos(lower(p.name), lower($1)) > 0)
        AND (cardinality($3::bigint[]) = 0 OR p.id = ANY($3::bigint[]))`;
  } else {
    const field = await q.query(
      `SELECT field_type, config, access_level, editor_ids FROM custom_fields
       WHERE id = $1::bigint AND project_id = $2::bigint AND deleted_at IS NULL`,
      [input.fieldId, projectId],
    );
    const row = field.rows[0];
    if (!row || row.field_type !== "reference") return { ok: false, error: "reference field not found", status: 404 };
    if (!(await canEditFieldValue(userId, projectId, row, q))) return { ok: false, error: "field access denied", status: 403 };
    const rawSources: unknown = row.config?.source_project_ids;
    if (Array.isArray(rawSources) && rawSources.some((id) =>
      (typeof id !== "number" && typeof id !== "string") || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      return { ok: true, options: [], hasMore: false };
    }
    const sources = Array.isArray(rawSources)
      ? [...new Set(rawSources.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))] : [];
    if (sources.length === 0) return { ok: true, options: [], hasMore: false };
    const access = await q.query(
      `SELECT p.id FROM projects p WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin AND u.deactivated_at IS NULL)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))`,
      [sources, userId],
    );
    if (access.rowCount !== sources.length) return { ok: false, error: "source project access denied", status: 403 };
    params.push(sources);
    statement = `SELECT t.id AS value, t.name AS label FROM tasks t
      WHERE t.deleted_at IS NULL AND $2::bigint IS NOT NULL AND ${projectTaskScope("t", "ANY($4::bigint[])")}
        AND ($1 = '' OR strpos(lower(t.name), lower($1)) > 0)
        AND (cardinality($3::bigint[]) = 0 OR t.id = ANY($3::bigint[]))`;
  }
  const limit = ids.length > 0 ? 50 : 30;
  const rows = await q.query(`${statement} ORDER BY label, value LIMIT ${limit + 1}`, params);
  return {
    ok: true,
    options: rows.rows.slice(0, limit).map((row) => ({
      value: Number(row.value), label: String(row.label),
      ...(row.description ? { description: String(row.description) } : {}),
    })),
    hasMore: rows.rows.length > limit,
  };
}
