/**
 * Raw issue-key lookups with no permission checks (docs/dev-projects-phase0.md
 * §5). The read services use these for display and inside their own
 * visibility filters; resolution with access checks lives in task-keys.ts.
 */
import { notFound } from "../api/errors";
import { db, type Queryable } from "../db";
import { formatTaskKey, normalizeDevPrefix, parseTaskKey } from "../dev-project-keys";

export type DevProjectSettings = { prefix: string; start_status: string | null };

/** Single-workspace deployments: the first workspace, as elsewhere in queries. */
async function workspaceId(q: Queryable): Promise<number> {
  const result = await q.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const id = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("workspace not found");
  return id;
}

/**
 * The task id behind a key. Callers must check access themselves; searches
 * use it only inside their own visibility filter. Old prefixes resolve
 * through dev_project_prefixes.
 */
export async function lookupTaskKey(text: unknown, q: Queryable = db): Promise<number | null> {
  const key = parseTaskKey(text);
  if (!key) return null;
  const result = await q.query(
    `SELECT k.task_id
       FROM dev_project_prefixes pp
       JOIN task_keys k ON k.namespace_id = pp.namespace_id AND k.number = $3
      WHERE pp.workspace_id = $1 AND pp.prefix = $2`,
    [await workspaceId(q), key.prefix, key.number],
  );
  const id = result.rows[0]?.task_id;
  return id == null ? null : Number(id);
}

/** The project currently enabled under a prefix (current or old). */
export async function lookupProjectPrefix(text: unknown, q: Queryable = db): Promise<number | null> {
  const prefix = normalizeDevPrefix(text);
  if (!prefix) return null;
  const result = await q.query(
    `SELECT d.project_id
       FROM dev_project_prefixes pp
       JOIN dev_projects d ON d.id = pp.namespace_id
      WHERE pp.workspace_id = $1 AND pp.prefix = $2`,
    [await workspaceId(q), prefix],
  );
  const id = result.rows[0]?.project_id;
  return id == null ? null : Number(id);
}

/**
 * Keys for a batch of tasks in one query. A key is shown with the current
 * prefix of the project that issued it, wherever the task is now.
 */
export async function taskKeysFor(taskIds: readonly number[], q: Queryable = db): Promise<Map<number, string>> {
  const keys = new Map<number, string>();
  if (taskIds.length === 0) return keys;
  const result = await q.query(
    `SELECT k.task_id, d.prefix, k.number
       FROM task_keys k JOIN dev_projects d ON d.id = k.namespace_id
      WHERE k.task_id = ANY($1::bigint[])`,
    [taskIds],
  );
  for (const row of result.rows) {
    keys.set(Number(row.task_id), formatTaskKey(String(row.prefix), Number(row.number)));
  }
  return keys;
}

/** Development settings for a batch of projects; projects without one are absent. */
export async function devSettingsFor(
  projectIds: readonly number[],
  q: Queryable = db,
): Promise<Map<number, DevProjectSettings>> {
  const settings = new Map<number, DevProjectSettings>();
  if (projectIds.length === 0) return settings;
  const result = await q.query(
    `SELECT project_id, prefix, start_status FROM dev_projects WHERE project_id = ANY($1::bigint[])`,
    [projectIds],
  );
  for (const row of result.rows) {
    settings.set(Number(row.project_id), {
      prefix: String(row.prefix),
      start_status: row.start_status == null ? null : String(row.start_status),
    });
  }
  return settings;
}
