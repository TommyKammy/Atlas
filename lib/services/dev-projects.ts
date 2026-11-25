import { ApiError, badRequest, conflict, notFound } from "../api/errors";
import { audit } from "../audit";
import { withTransaction, type Queryable } from "../db";
import { normalizeDevPrefix } from "../dev-project-keys";
import { requireProjectAccess, type Actor } from "./actor";

/**
 * Upper bound on tasks keyed while enabling a project. Enabling holds the
 * project row lock, which makes task creation in that project wait, so the
 * backfill is kept short (docs/dev-projects-phase0.md §4.2).
 */
export const DEV_PROJECT_ENABLE_MAX_TASKS = 20_000;

/**
 * Waits between attempts when a task in the project is locked FOR UPDATE.
 * Enabling never waits on task rows (that could deadlock), so it fails fast
 * and retries; those locks are held for the length of one request.
 */
export const DEV_PROJECT_ENABLE_RETRY_DELAYS_MS = [50, 150, 400, 1000];

export type EnableDevProjectInput = {
  prefix: unknown;
  start_status?: unknown;
};

export type EnabledDevProject = {
  namespaceId: number;
  prefix: string;
  branchPrefix: string;
  startStatus: string | null;
  keyed: number;
};

function parseInput(input: EnableDevProjectInput): { prefix: string; startStatus: string | null } {
  const prefix = normalizeDevPrefix(input.prefix);
  if (!prefix) {
    throw badRequest("prefix must be 2–10 letters or digits and start with a letter");
  }
  const raw = input.start_status;
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    throw badRequest("start_status must be a string or null");
  }
  const startStatus = typeof raw === "string" && raw !== "" ? raw : null;
  return { prefix, startStatus };
}

/** Map errors raised by atlas_enable_dev_project to API errors. */
export function enableDevProjectError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "DK404": return notFound("project not found");
    case "DK409": return conflict("project is already a development project");
    case "DK413": return conflict(
      `project has more than ${DEV_PROJECT_ENABLE_MAX_TASKS} tasks and cannot be enabled at once`,
    );
    case "DK422": return badRequest("start_status must be one of the project status options");
    case "23505": return conflict("prefix is already used in this workspace");
    case "55P03": return new ApiError(
      409, "tasks in this project are being edited; try again", "dev_project_busy",
    );
    default: return error;
  }
}

/**
 * Enable a project as a development project inside the caller's transaction.
 * No authorization: callers check access first.
 */
export async function enableDevProjectTx(
  q: Queryable,
  projectId: number,
  input: EnableDevProjectInput,
  enabledBy: number | null,
  maxTasks = DEV_PROJECT_ENABLE_MAX_TASKS,
): Promise<EnabledDevProject> {
  const { prefix, startStatus } = parseInput(input);
  let result;
  try {
    result = await q.query(
      "SELECT namespace_id, keyed FROM atlas_enable_dev_project($1::bigint, $2::text, $3::text, $4::bigint, $5::int)",
      [projectId, prefix, startStatus, enabledBy, maxTasks],
    );
  } catch (error) {
    throw enableDevProjectError(error);
  }
  const row = result.rows[0] as { namespace_id: number; keyed: number };
  return {
    namespaceId: Number(row.namespace_id),
    prefix,
    branchPrefix: prefix.toLowerCase(),
    startStatus,
    keyed: Number(row.keyed),
  };
}

function isBusy(error: unknown): boolean {
  return error instanceof ApiError && error.code === "dev_project_busy";
}

/** Run one enable transaction, retrying while tasks are locked (55P03). */
export async function retryWhileBusy<T>(
  run: () => Promise<T>,
  delays: readonly number[] = DEV_PROJECT_ENABLE_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isBusy(error) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

/**
 * Enable a project as a development project for an actor with configure
 * access. Not yet reachable from routes or MCP; the screens and the
 * workspace-level permission arrive in a later change (§9, §12).
 */
export async function enableDevProject(
  actor: Actor,
  projectId: number,
  input: EnableDevProjectInput,
): Promise<EnabledDevProject> {
  await requireProjectAccess(actor, projectId, "configure");
  const enabled = await retryWhileBusy(() =>
    withTransaction((q) => enableDevProjectTx(q, projectId, input, actor.uid)));
  await audit(actor.uid, "project.dev_enable", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `開発プロジェクトを有効化（接頭辞 ${enabled.prefix}、既存タスク ${enabled.keyed} 件にキーを付与）`,
  });
  return enabled;
}
