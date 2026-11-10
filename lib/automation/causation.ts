import type { Queryable } from "../db";

export type AutomationLineage = { rootEventId: number; ruleIds: number[] };

/** Older queued events may have causation IDs without the new lineage fields. */
export async function automationLineage(q: Queryable, eventId: number): Promise<AutomationLineage | null> {
  const { rows: [row] } = await q.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, causation_id, automation_root_event_id, automation_rule_path, ARRAY[id] AS visited
       FROM domain_events WHERE id = $1::bigint
       UNION ALL
       SELECT parent.id, parent.causation_id, parent.automation_root_event_id,
         parent.automation_rule_path, child.visited || parent.id
       FROM domain_events parent JOIN ancestors child ON parent.id = child.causation_id
       WHERE child.automation_root_event_id IS NULL AND NOT parent.id = ANY(child.visited)
         AND cardinality(child.visited) < 64
     )
     SELECT COALESCE(automation_root_event_id, id) AS root_id, automation_rule_path,
       automation_root_event_id, causation_id
     FROM ancestors ORDER BY cardinality(visited) DESC LIMIT 1`,
    [eventId],
  );
  if (!row || (row.automation_root_event_id === null && row.causation_id !== null)) return null;
  return {
    rootEventId: Number(row.root_id),
    ruleIds: (row.automation_rule_path as (number | string)[]).map(Number),
  };
}
