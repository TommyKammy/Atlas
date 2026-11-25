/**
 * Issue-key resolution shared by MCP and (later) the screens
 * (docs/dev-projects-phase0.md §5).
 *
 * A numeric reference keeps the existing behaviour, including its 403/404
 * distinction. A key or prefix reference never reveals whether something
 * exists that the actor cannot view: both cases are the same not-found error.
 */
import { ApiError, badRequest, notFound } from "../api/errors";
import { db, type Queryable } from "../db";
import { formatTaskKey, normalizeDevPrefix, parseTaskKey } from "../dev-project-keys";
import { requireProjectAccess, requireTaskAccess, type Actor } from "./actor";
import type { ProjectPermission } from "../api-project-auth";

export type TaskRef = number | string;
export type ProjectRef = number | string;

export type DevProjectSettings = { prefix: string; start_status: string | null };

export const TASK_KEY_NOT_FOUND = "task not found";
export const PROJECT_PREFIX_NOT_FOUND = "project not found";

/** Single-workspace deployments: the first workspace, as elsewhere in queries. */
async function workspaceId(q: Queryable): Promise<number> {
  const result = await q.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const id = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("workspace not found");
  return id;
}

/**
 * The task id behind a key, without any permission check. Callers must check
 * access themselves; searches use it only inside their own visibility filter.
 * Old prefixes resolve through dev_project_prefixes.
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

/** The project currently enabled under a prefix (current or old), without a permission check. */
async function lookupProjectPrefix(text: string, q: Queryable): Promise<number | null> {
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

function isAccessError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

/**
 * Run `fn` for a reference, turning every 403/404 into the same not-found
 * error when the reference was a key or prefix. Reads that follow resolution
 * (for example an archived project) must not tell the caller more than the
 * resolver did.
 */
export async function hidingAccess<T>(ref: TaskRef | ProjectRef, message: string, fn: () => Promise<T>): Promise<T> {
  if (typeof ref === "number") return fn();
  try {
    return await fn();
  } catch (error) {
    if (isAccessError(error)) throw notFound(message);
    throw error;
  }
}

/**
 * Resolve a task id or key. Keys are checked for `access` here, so an
 * unknown key and a key the actor cannot see give the same error.
 */
export async function resolveTaskRef(
  actor: Actor,
  ref: TaskRef,
  access: ProjectPermission = "view",
  q: Queryable = db,
): Promise<number> {
  if (typeof ref === "number") return ref;
  if (!parseTaskKey(ref)) throw badRequest("task must be a numeric id or a key such as ATL-123");
  const taskId = await lookupTaskKey(ref, q);
  if (taskId === null) throw notFound(TASK_KEY_NOT_FOUND);
  await hidingAccess(ref, TASK_KEY_NOT_FOUND, () => requireTaskAccess(actor, taskId, access, { q }));
  return taskId;
}

/**
 * Resolve a project id or a development-project prefix (current or old).
 * Prefixes are checked for view access here, with the same not-found error
 * for unknown prefixes and projects the actor cannot view.
 */
export async function resolveProjectRef(
  actor: Actor,
  ref: ProjectRef,
  q: Queryable = db,
): Promise<number> {
  if (typeof ref === "number") return ref;
  if (!normalizeDevPrefix(ref)) throw badRequest("project must be a numeric id or a development-project prefix such as ATL");
  const projectId = await lookupProjectPrefix(ref, q);
  if (projectId === null) throw notFound(PROJECT_PREFIX_NOT_FOUND);
  await hidingAccess(ref, PROJECT_PREFIX_NOT_FOUND, () => requireProjectAccess(actor, projectId, "view", q));
  return projectId;
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
