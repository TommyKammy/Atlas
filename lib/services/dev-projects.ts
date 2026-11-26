import { ApiError, badRequest, conflict, notFound } from "../api/errors";
import { audit } from "../audit";
import { db, withTransaction, type Queryable } from "../db";
import { normalizeDevPrefix } from "../dev-project-keys";
import { requireProjectAccess, type Actor } from "./actor";
import { devProjectsAllowedForProject } from "./workspace-features";

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

/** Thrown when the workspace has not allowed development projects (§9). */
export function devProjectsDisabled(): ApiError {
  return new ApiError(403, "development projects are not enabled for this workspace", "dev_projects_disabled");
}

async function requireDevProjectsAllowed(projectId: number, q: Queryable = db): Promise<void> {
  if (!(await devProjectsAllowedForProject(projectId, q))) throw devProjectsDisabled();
}

/**
 * Enable a project as a development project for an actor with configure
 * access, when the workspace allows development projects.
 */
export async function enableDevProject(
  actor: Actor,
  projectId: number,
  input: EnableDevProjectInput,
): Promise<EnabledDevProject> {
  await requireProjectAccess(actor, projectId, "configure");
  await requireDevProjectsAllowed(projectId);
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

export type DevProjectSettingsView = {
  /** Whether the workspace allows development projects (Admin → Features). */
  allowed: boolean;
  dev: {
    prefix: string;
    branch_prefix: string;
    start_status: string | null;
    /** Earlier prefixes that still resolve, oldest first. */
    old_prefixes: string[];
    enabled_at: string;
  } | null;
  status_options: string[];
  status_field_enabled: boolean;
};

/** The development settings of a project, for its settings screen. */
export async function getDevProjectSettings(actor: Actor, projectId: number): Promise<DevProjectSettingsView> {
  await requireProjectAccess(actor, projectId, "configure");
  const result = await db.query(
    `SELECT COALESCE(p.status_options, '[]'::jsonb) AS status_options,
            p.status_field_enabled,
            COALESCE(f.dev_projects, false) AS allowed,
            d.id AS namespace_id, d.prefix, d.branch_prefix, d.start_status,
            d.enabled_at::text AS enabled_at
       FROM projects p
       LEFT JOIN workspace_features f ON f.workspace_id = p.workspace_id
       LEFT JOIN dev_projects d ON d.project_id = p.id
      WHERE p.id = $1::bigint`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("project not found");
  let dev: DevProjectSettingsView["dev"] = null;
  if (row.namespace_id != null) {
    const prefixes = await db.query(
      `SELECT prefix FROM dev_project_prefixes
        WHERE namespace_id = $1::bigint AND prefix <> $2 ORDER BY created_at, prefix`,
      [row.namespace_id, row.prefix],
    );
    dev = {
      prefix: String(row.prefix),
      branch_prefix: String(row.branch_prefix),
      start_status: row.start_status == null ? null : String(row.start_status),
      old_prefixes: prefixes.rows.map((entry) => String(entry.prefix)),
      enabled_at: String(row.enabled_at),
    };
  }
  return {
    allowed: row.allowed === true,
    dev,
    status_options: Array.isArray(row.status_options) ? row.status_options.map(String) : [],
    status_field_enabled: row.status_field_enabled !== false,
  };
}

export type UpdateDevProjectInput = { prefix?: unknown; start_status?: unknown };

/**
 * Change a development project's prefix or start status (§9). A new prefix is
 * recorded alongside the old ones, which keep resolving and stay reserved for
 * this project; switching back to an old prefix is allowed. The branch prefix
 * never changes, so branch names survive a rename.
 *
 * Locks the project row FOR SHARE and then the settings row FOR UPDATE: the
 * order a status edit uses (§4.4), so the start status is checked against the
 * options that will be stored.
 */
export async function updateDevProject(
  actor: Actor,
  projectId: number,
  input: UpdateDevProjectInput,
): Promise<DevProjectSettingsView> {
  await requireProjectAccess(actor, projectId, "configure");
  await requireDevProjectsAllowed(projectId);
  if (!input || typeof input !== "object") throw badRequest("invalid development settings");
  const hasPrefix = input.prefix !== undefined;
  const hasStart = input.start_status !== undefined;
  if (!hasPrefix && !hasStart) throw badRequest("prefix or start_status required");
  const prefix = hasPrefix ? normalizeDevPrefix(input.prefix) : null;
  if (hasPrefix && !prefix) throw badRequest("prefix must be 2–10 letters or digits and start with a letter");
  if (hasStart && input.start_status !== null && typeof input.start_status !== "string") {
    throw badRequest("start_status must be a string or null");
  }
  const startStatus = typeof input.start_status === "string" && input.start_status !== "" ? input.start_status : null;

  const changes = await withTransaction(async (q) => {
    const project = await q.query(
      `SELECT workspace_id, COALESCE(status_options, '[]'::jsonb) AS status_options
         FROM projects WHERE id = $1::bigint FOR SHARE`,
      [projectId],
    );
    if (!project.rows[0]) throw notFound("project not found");
    const dev = await q.query(
      "SELECT id, prefix, start_status FROM dev_projects WHERE project_id = $1::bigint FOR UPDATE",
      [projectId],
    );
    const current = dev.rows[0];
    if (!current) throw conflict("project is not a development project");
    const summary: string[] = [];
    if (prefix && prefix !== current.prefix) {
      const owner = await q.query(
        "SELECT namespace_id FROM dev_project_prefixes WHERE workspace_id = $1::bigint AND prefix = $2",
        [project.rows[0].workspace_id, prefix],
      );
      if (owner.rows[0] && Number(owner.rows[0].namespace_id) !== Number(current.id)) {
        throw conflict("prefix is already used in this workspace");
      }
      if (!owner.rows[0]) {
        try {
          await q.query(
            "INSERT INTO dev_project_prefixes (workspace_id, prefix, namespace_id) VALUES ($1, $2, $3)",
            [project.rows[0].workspace_id, prefix, current.id],
          );
        } catch (error) {
          throw enableDevProjectError(error);
        }
      }
      await q.query("UPDATE dev_projects SET prefix = $2 WHERE id = $1", [current.id, prefix]);
      summary.push(`接頭辞 ${current.prefix} → ${prefix}`);
    }
    if (hasStart && startStatus !== (current.start_status ?? null)) {
      const options = Array.isArray(project.rows[0].status_options)
        ? project.rows[0].status_options.map(String)
        : [];
      if (startStatus !== null && !options.includes(startStatus)) {
        throw badRequest("start_status must be one of the project status options");
      }
      await q.query("UPDATE dev_projects SET start_status = $2 WHERE id = $1", [current.id, startStatus]);
      summary.push(`着手時の状態 ${startStatus ?? "未設定"}`);
    }
    return summary;
  });
  if (changes.length > 0) {
    await audit(actor.uid, "project.dev_update", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: changes.join("、"),
    });
  }
  return getDevProjectSettings(actor, projectId);
}
