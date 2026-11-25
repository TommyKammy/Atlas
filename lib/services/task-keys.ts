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
import { normalizeDevPrefix, parseTaskKey } from "../dev-project-keys";
import type { ProjectPermission } from "../api-project-auth";
import { requireProjectAccess, requireTaskAccess, type Actor } from "./actor";
import { requireTaskReadable } from "./queries";
import { lookupProjectPrefix, lookupTaskKey } from "./task-key-lookup";

export {
  devSettingsFor, lookupTaskKey, taskKeysFor, type DevProjectSettings,
} from "./task-key-lookup";

export type TaskRef = number | string;
export type ProjectRef = number | string;

export const TASK_KEY_NOT_FOUND = "task not found";
export const PROJECT_PREFIX_NOT_FOUND = "project not found";

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
 *
 * `view` uses the read services' rule (`requireTaskReadable`), which also
 * accepts a compatible parent's homes, so a key reads exactly the tasks the
 * numeric id does. Other levels use `requireTaskAccess`, the rule the write
 * services apply. `q` applies to the lookup and to non-view checks; the read
 * rule always runs on the pool, like the read services themselves.
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
  await hidingAccess(ref, TASK_KEY_NOT_FOUND, async () => {
    if (access === "view") await requireTaskReadable(actor, taskId);
    else await requireTaskAccess(actor, taskId, access, { q });
  });
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
