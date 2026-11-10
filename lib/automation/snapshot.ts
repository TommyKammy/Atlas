import type { Queryable } from "../db";
import type { DomainEventRow } from "../domain/events";
import { lockRuleSubject, readRuleSubject } from "../repositories/task-rule-snapshot";
import type { RuleSnapshot } from "./evaluation";

export async function loadRuleSnapshot(event: DomainEventRow, q: Queryable, readOnly = false): Promise<RuleSnapshot | null> {
  const scope = readOnly ? await readRuleSubject(q, event) : await lockRuleSubject(q, event, { snapshot: true });
  if (!scope) return null;
  const { task, project } = scope;
  const custom: Record<string, unknown> = Object.create(null);
  if (task) {
    const values = await q.query(
      `SELECT v.field_id, v.value_text, v.value_number, v.value_date::text AS value_date,
         v.value_json, f.name AS field_name
       FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
       WHERE v.task_id = $1::bigint AND f.project_id = $2::bigint AND f.deleted_at IS NULL`,
      [event.subject_id, event.project_id],
    );
    for (const row of values.rows) {
      const value = row.value_number !== null && row.value_number !== undefined ? row.value_number
        : row.value_date !== null && row.value_date !== undefined ? row.value_date
          : row.value_json !== null && row.value_json !== undefined ? row.value_json : row.value_text;
      custom[String(row.field_id)] = value;
      custom[String(row.field_name)] = value;
    }
  }
  return { task, project, custom, event };
}
