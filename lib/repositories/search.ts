import { assertDataActor, projectDataAccess, type DataActor } from "../data-actor";
import { db } from "../db";
import { compatibleTaskParent } from "./scope";
import { emptySearchPage, searchPageRequest, type SearchPage, type SearchPageRequest } from "../search-pagination";

/** Count and page share one statement/snapshot, including an empty or out-of-range page. */
async function searchRows<T>(sql: string, params: unknown[], order: string, limit: number, request?: SearchPageRequest): Promise<T[] | SearchPage<T>> {
  if (!request) {
    const result = await db.query(`SELECT * FROM (${sql}) hits ORDER BY ${order} LIMIT ${limit}`, params);
    return result.rows as T[];
  }
  const { page, pageSize } = searchPageRequest(request.page, request.pageSize);
  const sizeParam = params.length + 1;
  const pageParam = params.length + 2;
  const result = await db.query(
    `WITH hits AS MATERIALIZED (${sql}),
      counted AS (SELECT count(*) AS total FROM hits),
      bounds AS (SELECT total, GREATEST(1, CEIL(total::numeric / $${sizeParam}::integer)) AS page_count FROM counted),
      paging AS (SELECT *, LEAST($${pageParam}::bigint, page_count) AS page FROM bounds)
     SELECT total::text, page::text, page_count::text,
       COALESCE((SELECT jsonb_agg(row) FROM (
         SELECT * FROM hits ORDER BY ${order}
         LIMIT $${sizeParam}::integer OFFSET ((paging.page - 1) * $${sizeParam}::integer)
       ) row), '[]'::jsonb) AS items FROM paging`,
    [...params, pageSize, page],
  );
  const row = result.rows[0];
  return { items: row.items as T[], total: Number(row.total), page: Number(row.page), pageCount: Number(row.page_count), pageSize };
}


/**
 * Project-home SELECT arms shared by task search and single-task reads. Every
 * arm yields one candidate project; callers union them so duplicates disappear.
 * The order is also the read preference: the task's own primary project, its
 * multi-home memberships, then the same two sources on the immediate parent.
 * Parent arms only contribute when `compatibleTaskParent` allows it.
 */
function taskHomeArms(
  child: string,
  parent: string,
  options: { requireActiveParent?: boolean } = {},
): string[] {
  // Search predates the deleted-parent filter; task reads hide deleted parents.
  const activeParent = options.requireActiveParent ? ` AND ${parent}.deleted_at IS NULL` : "";
  return [
    `SELECT ${child}.project_id AS project_id WHERE ${child}.project_id IS NOT NULL`,
    `SELECT membership.project_id FROM task_project_memberships membership
     WHERE membership.task_id = ${child}.id`,
    `SELECT ${parent}.project_id FROM tasks ${parent}
     WHERE ${parent}.id = ${child}.parent_task_id AND ${parent}.project_id IS NOT NULL
       AND ${compatibleTaskParent(child, parent)}${activeParent}`,
    `SELECT inherited_membership.project_id FROM tasks ${parent}
     JOIN task_project_memberships inherited_membership ON inherited_membership.task_id = ${parent}.id
     WHERE ${parent}.id = ${child}.parent_task_id
       AND ${compatibleTaskParent(child, parent)}${activeParent}`,
  ];
}

// A task is searchable through its own homes and a compatible parent's homes.
// UNION removes duplicates; result queries choose one authorized return home.
const TASK_SEARCH_HOMES = `
  JOIN LATERAL (
    ${taskHomeArms("t", "inherited_parent").join("\n    UNION\n    ")}
  ) task_home ON TRUE
  JOIN projects p ON p.id = task_home.project_id`;

/**
 * Ordered homes for reading one task: own primary, own memberships, compatible
 * parent's primary, compatible parent's memberships. `null` means the task is
 * missing or deleted; `[]` means it exists without a home (admin-only read).
 * Deleted parents do not contribute a home.
 */
export async function getTaskReadHomeProjectIds(taskId: number): Promise<number[] | null> {
  const arms = taskHomeArms("t", "inherited_parent", { requireActiveParent: true })
    .map((arm, rank) => `SELECT home.project_id, ${rank} AS home_rank FROM (${arm}) home`)
    .join("\n     UNION ALL\n     ");
  const result = await db.query(
    `SELECT candidates.project_id
     FROM tasks t
     LEFT JOIN LATERAL (
       ${arms}
     ) candidates ON TRUE
     WHERE t.id = $1::bigint AND t.deleted_at IS NULL
     ORDER BY candidates.home_rank, candidates.project_id`,
    [taskId],
  );
  if (result.rows.length === 0) return null;
  const projectIds: number[] = [];
  const seen = new Set<number>();
  for (const row of result.rows) {
    if (row.project_id === null || row.project_id === undefined) continue;
    const id = Number(row.project_id);
    if (!seen.has(id)) {
      seen.add(id);
      projectIds.push(id);
    }
  }
  return projectIds;
}

export { getDirectoryUsers as getSearchUsers } from "./users";

export type AdvancedSearchFilters = {
  q: string;
  projectId: number | null;
  assigneeId: number | null | "none";
  completed: "all" | "open" | "done";
  status: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  completedFrom: string | null;
  completedTo: string | null;
  custom: { fieldId: number; value: string; type: string }[];
  /**
   * The task an exact issue-key query (for example "ATL-123") names. It is
   * matched in addition to the text and ranked first, but only within the
   * same visibility and filters as every other row.
   */
  keyTaskId?: number | null;
};

export type AdvancedTaskHit = {
  id: number;
  name: string;
  completed: boolean;
  progress: number;
  due_on: string | null;
  assignee_name: string | null;
  project_id: number;
  project_name: string;
};

export function searchTasksAdvanced(workspaceId: number, f: AdvancedSearchFilters, actor: DataActor): Promise<AdvancedTaskHit[]>;
export function searchTasksAdvanced(workspaceId: number, f: AdvancedSearchFilters, actor: DataActor, page: SearchPageRequest): Promise<SearchPage<AdvancedTaskHit>>;
export async function searchTasksAdvanced(
  workspaceId: number,
  f: AdvancedSearchFilters,
  actor: DataActor,
  pagination?: SearchPageRequest,
) {
  assertDataActor(actor);
  const escaped = f.q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const like = `%${escaped}%`;
  const hasQuery = f.q !== "";
  const conds: string[] = ["p.workspace_id = $1", "p.archived_at IS NULL", "p.deleted_at IS NULL", "t.deleted_at IS NULL"];
  const params: unknown[] = [workspaceId];
  let likeParam = 0;
  let exactParam = 0;
  let prefixParam = 0;
  let keyParam = 0;
  if (hasQuery) {
    params.push(like);
    likeParam = params.length;
    params.push(f.q);
    exactParam = params.length;
    params.push(`${escaped}%`);
    prefixParam = params.length;
    let keyMatch = "";
    if (f.keyTaskId != null) {
      params.push(f.keyTaskId);
      keyParam = params.length;
      keyMatch = ` OR t.id = $${keyParam}`;
    }
    conds.push(`(t.name ILIKE $${likeParam} OR t.description ILIKE $${likeParam}
      OR EXISTS (SELECT 1 FROM comments c WHERE c.task_id = t.id AND c.body ILIKE $${likeParam})${keyMatch})`);
  }
  params.push(actor.userId);
  conds.push(projectDataAccess("p", `$${params.length}`));
  if (f.projectId !== null) {
    params.push(f.projectId);
    conds.push(`p.id = $${params.length}`);
  }
  if (f.assigneeId === "none") conds.push("t.assignee_id IS NULL");
  else if (f.assigneeId !== null) {
    params.push(f.assigneeId);
    conds.push(`t.assignee_id = $${params.length}`);
  }
  if (f.completed === "open") conds.push("t.completed = FALSE");
  else if (f.completed === "done") conds.push("t.completed = TRUE");
  if (f.status !== null && f.status !== "") {
    params.push(f.status);
    conds.push(`t.status = $${params.length}`);
  }
  if (f.dueFrom) {
    params.push(f.dueFrom);
    conds.push(`t.due_on >= $${params.length}`);
  }
  if (f.dueTo) {
    params.push(f.dueTo);
    conds.push(`t.due_on <= $${params.length}`);
  }
  if (f.createdFrom) {
    params.push(f.createdFrom);
    conds.push(`t.created_at::date >= $${params.length}`);
  }
  if (f.createdTo) {
    params.push(f.createdTo);
    conds.push(`t.created_at::date <= $${params.length}`);
  }
  if (f.completedFrom) {
    params.push(f.completedFrom);
    conds.push(`t.completed_at::date >= $${params.length}`);
  }
  if (f.completedTo) {
    params.push(f.completedTo);
    conds.push(`t.completed_at::date <= $${params.length}`);
  }
  for (const filter of f.custom) {
    if (filter.type === "number" && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(filter.value) || !Number.isFinite(Number(filter.value)))) {
      conds.push("FALSE");
      continue;
    }
    params.push(filter.fieldId);
    const fieldParam = params.length;
    params.push(filter.value);
    const valueParam = params.length;
    const valueScope = `SELECT 1 FROM task_custom_values v
      JOIN custom_fields cf ON cf.id = v.field_id
      WHERE v.task_id = t.id AND v.field_id = $${fieldParam}
        AND cf.project_id = p.id AND cf.deleted_at IS NULL`;
    if (filter.type === "number") {
      conds.push(`EXISTS (${valueScope} AND v.value_number = $${valueParam}::double precision)`);
    } else if (filter.type === "multi_select") {
      conds.push(`EXISTS (${valueScope} AND v.value_json @> to_jsonb($${valueParam}::text))`);
    } else {
      conds.push(`EXISTS (${valueScope} AND v.value_text = $${valueParam})`);
    }
  }
  const rankSql = hasQuery
    ? `CASE
         ${keyParam ? `WHEN t.id = $${keyParam} THEN -1` : ""}
         WHEN lower(t.name) = lower($${exactParam}) THEN 0
         WHEN t.name ILIKE $${prefixParam} THEN 1
         WHEN t.name ILIKE $${likeParam} THEN 2
         WHEN t.description ILIKE $${likeParam} THEN 3
         ELSE 4
       END`
    : "0";
  return searchRows<AdvancedTaskHit>(
    `SELECT DISTINCT ON (t.id) t.id, t.name, t.completed, t.progress, t.due_on::text AS due_on,
       u.name AS assignee_name, p.id AS project_id, p.name AS project_name,
       ${rankSql} AS match_rank, t.updated_at
     FROM tasks t ${TASK_SEARCH_HOMES}
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE ${conds.join(" AND ")}
     ORDER BY t.id, (p.id = t.project_id) DESC NULLS LAST, p.id`,
    params, "match_rank, due_on NULLS LAST, updated_at DESC, id", 100, pagination,
  );
}

export type GlobalProjectHit = {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
};

export type GlobalMessageHit = {
  id: number;
  title: string;
  body: string;
  project_id: number;
  project_name: string;
  created_at: string;
};

export type GlobalKnowledgeHit = {
  id: number;
  title: string;
  body: string;
  project_id: number;
  project_name: string;
  updated_at: string;
};

export type GlobalFileHit = {
  id: number;
  file_name: string;
  mime_type: string;
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  created_at: string;
};

/** Projects whose name matches the keyword, exact/prefix/contains first. */
export function searchProjectsGlobal(workspaceId: number, q: string, actor: DataActor): Promise<GlobalProjectHit[]>;
export function searchProjectsGlobal(workspaceId: number, q: string, actor: DataActor, page: SearchPageRequest): Promise<SearchPage<GlobalProjectHit>>;
export async function searchProjectsGlobal(
  workspaceId: number,
  q: string,
  actor: DataActor,
  pagination?: SearchPageRequest,
): Promise<GlobalProjectHit[] | SearchPage<GlobalProjectHit>> {
  assertDataActor(actor);
  if (q.trim() === "") return pagination ? emptySearchPage(20) : [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  params.push(actor.userId);
  const access = ` AND ${projectDataAccess("p", `$${params.length}`)}`;
  return searchRows<GlobalProjectHit>(
    `SELECT p.id, p.name, p.color, p.icon,
       CASE WHEN lower(p.name) = lower($3) THEN 0 WHEN p.name ILIKE $4 THEN 1 ELSE 2 END AS match_rank,
       p.created_at
     FROM projects p
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL AND p.name ILIKE $2${access}
`,
    params, "match_rank, created_at DESC, id", 20, pagination,
  );
}

/** Project messages (title/body) within the workspace. */
export function searchMessagesGlobal(workspaceId: number, q: string, actor: DataActor): Promise<GlobalMessageHit[]>;
export function searchMessagesGlobal(workspaceId: number, q: string, actor: DataActor, page: SearchPageRequest): Promise<SearchPage<GlobalMessageHit>>;
export async function searchMessagesGlobal(
  workspaceId: number,
  q: string,
  actor: DataActor,
  pagination?: SearchPageRequest,
): Promise<GlobalMessageHit[] | SearchPage<GlobalMessageHit>> {
  assertDataActor(actor);
  if (q.trim() === "") return pagination ? emptySearchPage(20) : [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  params.push(actor.userId);
  const access = ` AND ${projectDataAccess("p", `$${params.length}`)}`;
  return searchRows<GlobalMessageHit>(
    `SELECT m.id, m.title, m.body, m.created_at::text AS created_at,
       p.id AS project_id, p.name AS project_name,
       CASE WHEN lower(m.title) = lower($3) THEN 0 WHEN m.title ILIKE $4 THEN 1
         WHEN m.title ILIKE $2 THEN 2 ELSE 3 END AS match_rank,
       m.created_at AS sort_timestamp
     FROM project_messages m JOIN projects p ON p.id = m.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND (m.title ILIKE $2 OR m.body ILIKE $2)${access}
`,
    params, "match_rank, sort_timestamp DESC, id", 20, pagination,
  );
}

/** Knowledge notes (title/body) within the workspace. */
export function searchKnowledgeGlobal(workspaceId: number, q: string, actor: DataActor): Promise<GlobalKnowledgeHit[]>;
export function searchKnowledgeGlobal(workspaceId: number, q: string, actor: DataActor, page: SearchPageRequest): Promise<SearchPage<GlobalKnowledgeHit>>;
export async function searchKnowledgeGlobal(
  workspaceId: number,
  q: string,
  actor: DataActor,
  pagination?: SearchPageRequest,
): Promise<GlobalKnowledgeHit[] | SearchPage<GlobalKnowledgeHit>> {
  assertDataActor(actor);
  if (q.trim() === "") return pagination ? emptySearchPage(20) : [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  params.push(actor.userId);
  const access = ` AND ${projectDataAccess("p", `$${params.length}`)}`;
  return searchRows<GlobalKnowledgeHit>(
    `SELECT k.id, k.title, k.body, k.updated_at::text AS updated_at,
       p.id AS project_id, p.name AS project_name,
       CASE WHEN lower(k.title) = lower($3) THEN 0 WHEN k.title ILIKE $4 THEN 1
         WHEN k.title ILIKE $2 THEN 2 ELSE 3 END AS match_rank,
       k.updated_at AS sort_timestamp
     FROM project_knowledge k JOIN projects p ON p.id = k.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND k.deleted_at IS NULL AND (k.title ILIKE $2 OR k.body ILIKE $2)${access}
`,
    params, "match_rank, sort_timestamp DESC, id", 20, pagination,
  );
}

/** Attachment file names within the workspace. */
export function searchFilesGlobal(workspaceId: number, q: string, actor: DataActor): Promise<GlobalFileHit[]>;
export function searchFilesGlobal(workspaceId: number, q: string, actor: DataActor, page: SearchPageRequest): Promise<SearchPage<GlobalFileHit>>;
export async function searchFilesGlobal(
  workspaceId: number,
  q: string,
  actor: DataActor,
  pagination?: SearchPageRequest,
): Promise<GlobalFileHit[] | SearchPage<GlobalFileHit>> {
  assertDataActor(actor);
  if (q.trim() === "") return pagination ? emptySearchPage(20) : [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  params.push(actor.userId);
  const access = ` AND ${projectDataAccess("p", `$${params.length}`)}`;
  return searchRows<GlobalFileHit>(
    `SELECT id, file_name, mime_type, created_at, task_id, task_name, project_id, project_name, match_rank, created_timestamp
     FROM (
       SELECT DISTINCT ON (a.id) a.id, a.file_name, a.mime_type, a.created_at::text AS created_at,
         a.created_at AS created_timestamp, t.id AS task_id, t.name AS task_name,
         p.id AS project_id, p.name AS project_name,
         CASE WHEN lower(a.file_name) = lower($3) THEN 0
           WHEN a.file_name ILIKE $4 THEN 1 ELSE 2 END AS match_rank
       FROM task_attachments a
       JOIN tasks t ON t.id = a.task_id AND t.deleted_at IS NULL
       ${TASK_SEARCH_HOMES}
       WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
         AND a.file_name ILIKE $2${access}
       ORDER BY a.id, (p.id = t.project_id) DESC NULLS LAST, p.id
     ) hits
`,
    params, "match_rank, created_timestamp DESC, id", 20, pagination,
  );
}

export type SearchCustomField = {
  id: number;
  name: string;
  field_type: string;
  options: string[];
  project_name: string;
};

export async function getSearchHistory(userId: number, limit = 8): Promise<string[]> {
  const r = await db.query(
    "SELECT query FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit],
  );
  return r.rows.map((row) => row.query as string);
}

export async function saveSearchHistory(userId: number, query: string): Promise<void> {
  const q = query.trim().slice(0, 200);
  if (q === "") return;
  await db.query(
    `INSERT INTO search_history (user_id, query, created_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, query) DO UPDATE SET created_at = now()`,
    [userId, q],
  );
  await db.query(
    `DELETE FROM search_history
     WHERE user_id = $1 AND query NOT IN (
       SELECT query FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
     )`,
    [userId],
  );
}

export async function clearSearchHistory(userId: number): Promise<void> {
  await db.query("DELETE FROM search_history WHERE user_id = $1", [userId]);
}

export async function getSearchCustomFields(
  workspaceId: number,
  actor: DataActor,
): Promise<SearchCustomField[]> {
  assertDataActor(actor);
  const params: unknown[] = [workspaceId, actor.userId];
  const access = ` AND ${projectDataAccess("p", "$2")}`;
  const r = await db.query(
    `SELECT f.id, f.name, f.field_type, f.options, p.name AS project_name
     FROM custom_fields f JOIN projects p ON p.id = f.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL AND f.deleted_at IS NULL${access}
     ORDER BY p.id, f.position, f.id`,
    params,
  );
  return r.rows.map((row) => ({ ...row, options: (row.options ?? []) as string[] }));
}

export async function getSavedSearches(workspaceId: number, userId: number) {
  const r = await db.query(
    `SELECT id, name, params, created_at::text AS created_at
     FROM saved_searches WHERE workspace_id = $1 AND user_id = $2 ORDER BY id DESC`,
    [workspaceId, userId],
  );
  return r.rows as { id: number; name: string; params: Record<string, string>; created_at: string }[];
}

