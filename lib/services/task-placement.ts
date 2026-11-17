import type { Queryable } from "../db";
import { positionBetween, spaceTaskRanks, type TaskPlacement } from "../order";
import { TaskMutationFailure } from "./task-mutation-failure";

export function parseTaskPlacement(value: unknown, taskId: number): TaskPlacement {
  if (!value || typeof value !== "object") throw new TaskMutationFailure("invalid", "invalid task placement");
  const { project_id, anchor_id, side } = value as Record<string, unknown>;
  const validId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
  if (!validId(project_id) || (side !== "before" && side !== "after") ||
      (anchor_id !== null && !validId(anchor_id)) || anchor_id === taskId ||
      (anchor_id === null && side !== "after")) {
    throw new TaskMutationFailure("invalid", "invalid task placement");
  }
  return { project_id, anchor_id, side };
}

// All relative moves and absolute rank writes take this lock before locking tasks.
export async function lockTaskOrder(q: Queryable, projectId: number) {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas:task-order:' || $1::text, 0))", [projectId]);
}

// Only the exceptional dense-gap path rewrites peers. Keep legacy secondary homes
// at their old rank so that normalizing this project cannot reorder another one.
async function savePeerRanks(q: Queryable, projectId: number, peers: { id: number; position: number }[]) {
  const parameters = [projectId, peers.map(row => row.id), peers.map(row => row.position)];
  await q.query(
    `UPDATE task_project_memberships m SET position = t.position
     FROM unnest($2::bigint[], $3::double precision[]) r(id, rank) JOIN tasks t ON t.id = r.id
     WHERE t.project_id = $1 AND t.position <> r.rank AND m.task_id = t.id
       AND m.project_id <> $1 AND m.position IS NULL`, parameters,
  );
  await q.query(
    `UPDATE tasks t SET position = r.rank, updated_at = now()
     FROM unnest($2::bigint[], $3::double precision[]) r(id, rank)
     WHERE t.id = r.id AND t.project_id = $1 AND t.position <> r.rank`, parameters,
  );
  await q.query(
    `UPDATE task_project_memberships m SET position = r.rank
     FROM unnest($2::bigint[], $3::double precision[]) r(id, rank) JOIN tasks t ON t.id = r.id
     WHERE m.task_id = t.id AND m.project_id = $1 AND t.project_id IS DISTINCT FROM $1
       AND COALESCE(m.position, t.position) <> r.rank`, parameters,
  );
}

export async function resolveTaskPosition(q: Queryable, taskId: number, placement: TaskPlacement, sectionId?: number | null) {
  const projectId = placement.project_id;
  const peers = `SELECT t.id, COALESCE(m.position, t.position) AS position,
      CASE WHEN t.project_id = $1 THEN t.section_id ELSE m.section_id END AS section_id
    FROM tasks t LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1 AND t.project_id IS DISTINCT FROM m.project_id
    WHERE (t.project_id = $1 OR m.task_id IS NOT NULL)
      AND t.deleted_at IS NULL AND t.parent_task_id IS NULL AND t.id <> $2`;
  const params = [projectId, taskId];
  let previous: number | null;
  let next: number | null;
  if (placement.anchor_id === null) {
    const last = await q.query(`SELECT MAX(position) AS last FROM (${peers}) p`, params);
    previous = last.rows[0].last;
    next = null;
  } else {
    const before = placement.side === "before";
    const result = await q.query(
      `WITH peers AS (${peers})
       SELECT a.position, a.section_id,
         (SELECT p.position FROM peers p
          WHERE (p.position, p.id) ${before ? "<" : ">"} (a.position, a.id)
          ORDER BY ${before ? "p.position DESC, p.id DESC" : "p.position, p.id"} LIMIT 1) AS neighbor
       FROM peers a WHERE a.id = $3`, [...params, placement.anchor_id],
    );
    const anchor = result.rows[0];
    if (!anchor || (sectionId !== undefined && anchor.section_id !== sectionId)) {
      throw new TaskMutationFailure("conflict", "drop target changed");
    }
    previous = before ? anchor.neighbor : anchor.position;
    next = before ? anchor.position : anchor.neighbor;
  }
  const position = positionBetween(previous, next);
  if (position !== null) return position;

  const ordered = await q.query(
    `SELECT id, position FROM (${peers}) p ORDER BY position, id`, params,
  );
  const rows = ordered.rows as { id: number; position: number }[];
  const anchorIndex = placement.anchor_id === null ? rows.length : rows.findIndex(row => row.id === placement.anchor_id);
  if (anchorIndex < 0) throw new TaskMutationFailure("conflict", "drop target changed");
  const index = placement.anchor_id !== null && placement.side === "after" ? anchorIndex + 1 : anchorIndex;
  const ranks = spaceTaskRanks(rows, index, taskId);
  await savePeerRanks(q, projectId, ranks.filter(row => row.id !== taskId));
  return ranks.find(row => row.id === taskId)!.position;
}
