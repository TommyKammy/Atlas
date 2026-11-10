import type { Queryable } from "../db";
import type { RuleTrigger } from "./types";
import { defaultTriggerDays } from "./trigger-defaults";
import { PROJECT_AUTOMATION_SHARED_LOCK_SQL } from "../project-automation-lock";

const SCHEDULE_BATCH_SIZE = 150;

/** Select unfired tasks and persist their fire keys and outbox events atomically. */
export async function processScheduledTriggers(q: Queryable, now = new Date()): Promise<number> {
  const rules = await q.query(
    `SELECT r.id, r.version, r.definition->'triggers' AS triggers
     FROM project_rules r
     WHERE r.enabled AND r.owner_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(r.definition->'triggers') = 'array'
             THEN r.definition->'triggers' ELSE '[]'::jsonb END
         ) t WHERE t->>'event' IN ('task.due_soon', 'task.overdue')
       )
     ORDER BY r.id`,
  );
  let emitted = 0;
  for (const rule of rules.rows as { id: number; version: number; triggers: RuleTrigger[] }[]) {
    for (const trigger of rule.triggers) {
      if (trigger?.event !== "task.due_soon" && trigger?.event !== "task.overdue") continue;
      const days = Math.floor(Number(trigger.days ?? defaultTriggerDays(trigger.event)));
      if (!Number.isFinite(days) || days < 0 || days > 365) continue;
      const jstDate = "($5::timestamptz AT TIME ZONE 'Asia/Tokyo')::date";
      const fireKey = "concat($3::text, ':', $4::int, ':', t.id, ':', to_char(t.due_on, 'YYYY-MM-DD'))";
      if (trigger.event === "task.due_soon") {
        // Persist the day before the batch. Its outbox transaction may fail or
        // the worker may stop before it resumes after midnight.
        await q.query(
          `WITH project_automation_guard AS MATERIALIZED (
             ${PROJECT_AUTOMATION_SHARED_LOCK_SQL}
           )
           INSERT INTO automation_due_soon_scans (rule_id, days, scan_from)
           SELECT id, $3::int, ($4::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
           FROM project_rules CROSS JOIN project_automation_guard
           WHERE id = $1::bigint AND version = $2::int AND enabled AND owner_id IS NOT NULL
           FOR SHARE OF project_rules
           ON CONFLICT (rule_id, days) DO NOTHING`,
          [rule.id, rule.version, days, now],
        );
      }
      const scanWindow = trigger.event === "task.due_soon"
        ? `UPDATE automation_due_soon_scans scan
           SET scan_from = CASE
             WHEN scan.scan_from > ${jstDate} OR NOT EXISTS (
               SELECT 1 FROM tasks t
               WHERE t.project_id = r.project_id AND t.deleted_at IS NULL
                 AND t.parent_task_id IS NULL AND NOT t.completed
                 AND t.due_on BETWEEN scan.scan_from + $4::int AND ${jstDate} + $4::int
                 AND NOT EXISTS (
                   SELECT 1 FROM automation_fires f WHERE f.rule_id = r.id AND f.fire_key = ${fireKey}
                 )
             ) THEN ${jstDate} ELSE scan.scan_from END
           FROM active_rule r
           WHERE scan.rule_id = r.id AND scan.days = $4::int
           RETURNING scan.scan_from`
        : `SELECT ${jstDate} AS scan_from`;
      const dueCondition = trigger.event === "task.due_soon"
        ? `t.due_on BETWEEN scan.scan_from + $4::int AND ${jstDate} + $4::int`
        : days === 0
          ? `t.due_on < ${jstDate}`
          : `t.due_on <= ${jstDate} - $4::int`;

      const inserted = await q.query(
        `WITH project_automation_guard AS MATERIALIZED (
           ${PROJECT_AUTOMATION_SHARED_LOCK_SQL}
         ), active_rule AS (
           SELECT id, workspace_id, project_id, owner_id FROM project_rules
           CROSS JOIN project_automation_guard
           WHERE id = $1::bigint AND version = $2::int AND enabled AND owner_id IS NOT NULL
           FOR SHARE OF project_rules
         ), scan_window AS (
           ${scanWindow}
         ), candidates AS (
           SELECT t.id, t.due_on, due.date_iso, k.fire_key
           FROM active_rule r JOIN tasks t ON t.project_id = r.project_id
           CROSS JOIN scan_window scan
           CROSS JOIN LATERAL (VALUES (to_char(t.due_on, 'YYYY-MM-DD'))) due(date_iso)
           CROSS JOIN LATERAL (VALUES (${fireKey})) k(fire_key)
           WHERE t.deleted_at IS NULL AND t.parent_task_id IS NULL AND NOT t.completed
             AND ${dueCondition}
             AND NOT EXISTS (
               SELECT 1 FROM automation_fires f WHERE f.rule_id = r.id AND f.fire_key = k.fire_key
             )
           ORDER BY t.due_on, t.id
           LIMIT $6::int
         ), claimed AS (
           INSERT INTO automation_fires (rule_id, fire_key, subject_type, subject_id)
           SELECT $1::bigint, c.fire_key, 'task', c.id FROM candidates c
           ORDER BY c.due_on, c.id
           ON CONFLICT (rule_id, fire_key) DO NOTHING
           RETURNING subject_id, fire_key
         )
         INSERT INTO domain_events
           (workspace_id, project_id, actor_id, type, subject_type, subject_id, data, correlation_id)
         SELECT r.workspace_id, r.project_id, r.owner_id, $3::text, 'task', f.subject_id,
           jsonb_build_object('target_rule_id', r.id, 'days', $4::int, 'due_on', c.date_iso, 'fire_key', f.fire_key),
           concat('schedule:', r.id, ':', f.subject_id, ':', f.fire_key)
         FROM claimed f JOIN candidates c ON c.id = f.subject_id
         CROSS JOIN active_rule r`,
        [rule.id, rule.version, trigger.event, days, now, SCHEDULE_BATCH_SIZE],
      );
      emitted += inserted.rowCount ?? 0;
    }
  }
  return emitted;
}
