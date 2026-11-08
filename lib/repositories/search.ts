import { db } from "../db";
import type { User } from "../data";

export async function getSearchUsers(workspaceId: number, viewerUserId: number): Promise<User[]> {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
       u.deactivated_at::text AS deactivated_at
     FROM users u
     WHERE u.deactivated_at IS NULL
       AND (
         NOT EXISTS (SELECT 1 FROM users me WHERE me.id = $1 AND me.is_guest)
         OR u.id = $1
         OR EXISTS (
           SELECT 1
           FROM project_members a
           JOIN projects p ON p.id = a.project_id AND p.workspace_id = $2
           JOIN project_members b ON b.project_id = a.project_id AND b.user_id = u.id
           WHERE a.user_id = $1
         )
       )
     ORDER BY u.id`,
    [viewerUserId, workspaceId],
  );
  return r.rows;
}

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
};

export type AdvancedTaskHit = {
  id: number;
  name: string;
  completed: boolean;
  due_on: string | null;
  assignee_name: string | null;
  project_id: number;
  project_name: string;
};

export async function searchTasksAdvanced(
  workspaceId: number,
  f: AdvancedSearchFilters,
  viewerUserId?: number,
) {
  const escaped = f.q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const like = `%${escaped}%`;
  const hasQuery = f.q !== "";
  const conds: string[] = ["p.workspace_id = $1", "p.archived_at IS NULL", "t.deleted_at IS NULL"];
  const params: unknown[] = [workspaceId];
  let likeParam = 0;
  let exactParam = 0;
  let prefixParam = 0;
  if (hasQuery) {
    params.push(like);
    likeParam = params.length;
    params.push(f.q);
    exactParam = params.length;
    params.push(`${escaped}%`);
    prefixParam = params.length;
    conds.push(`(t.name ILIKE $${likeParam} OR t.description ILIKE $${likeParam}
      OR EXISTS (SELECT 1 FROM comments c WHERE c.task_id = t.id AND c.body ILIKE $${likeParam}))`);
  }
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    conds.push(`(EXISTS (SELECT 1 FROM users ux WHERE ux.id = $${params.length} AND ux.is_admin)
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $${params.length}))`);
  }
  if (f.projectId !== null) {
    params.push(f.projectId);
    conds.push(`t.project_id = $${params.length}`);
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
    params.push(filter.fieldId);
    const fieldParam = params.length;
    params.push(filter.value);
    const valueParam = params.length;
    if (filter.type === "number") {
      conds.push(`EXISTS (SELECT 1 FROM task_custom_values v WHERE v.task_id = t.id AND v.field_id = $${fieldParam} AND v.value_number = $${valueParam}::double precision)`);
    } else if (filter.type === "multi_select") {
      conds.push(`EXISTS (SELECT 1 FROM task_custom_values v WHERE v.task_id = t.id AND v.field_id = $${fieldParam} AND v.value_json @> to_jsonb($${valueParam}::text))`);
    } else {
      conds.push(`EXISTS (SELECT 1 FROM task_custom_values v WHERE v.task_id = t.id AND v.field_id = $${fieldParam} AND v.value_text = $${valueParam})`);
    }
  }
  const rankSql = hasQuery
    ? `CASE
         WHEN lower(t.name) = lower($${exactParam}) THEN 0
         WHEN t.name ILIKE $${prefixParam} THEN 1
         WHEN t.name ILIKE $${likeParam} THEN 2
         WHEN t.description ILIKE $${likeParam} THEN 3
         ELSE 4
       END`
    : "0";
  const r = await db.query(
    `SELECT t.id, t.name, t.completed, t.due_on::text AS due_on, u.name AS assignee_name,
       p.id AS project_id, p.name AS project_name, ${rankSql} AS match_rank
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE ${conds.join(" AND ")}
     ORDER BY match_rank, t.due_on NULLS LAST, t.updated_at DESC LIMIT 100`,
    params,
  );
  return r.rows as AdvancedTaskHit[];
}

function searchAccessClause(viewerUserId: number | undefined, paramIndex: number): string {
  if (viewerUserId === undefined) return "";
  return ` AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $${paramIndex} AND ux.is_admin)
    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $${paramIndex}))`;
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
export async function searchProjectsGlobal(
  workspaceId: number,
  q: string,
  viewerUserId?: number,
): Promise<GlobalProjectHit[]> {
  if (q.trim() === "") return [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  let access = "";
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    access = searchAccessClause(viewerUserId, params.length);
  }
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon
     FROM projects p
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.name ILIKE $2${access}
     ORDER BY CASE
       WHEN lower(p.name) = lower($3) THEN 0
       WHEN p.name ILIKE $4 THEN 1
       ELSE 2 END, p.created_at DESC
     LIMIT 20`,
    params,
  );
  return r.rows as GlobalProjectHit[];
}

/** Project messages (title/body) within the workspace. */
export async function searchMessagesGlobal(
  workspaceId: number,
  q: string,
  viewerUserId?: number,
): Promise<GlobalMessageHit[]> {
  if (q.trim() === "") return [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  let access = "";
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    access = searchAccessClause(viewerUserId, params.length);
  }
  const r = await db.query(
    `SELECT m.id, m.title, m.body, m.created_at::text AS created_at,
       p.id AS project_id, p.name AS project_name
     FROM project_messages m JOIN projects p ON p.id = m.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL
       AND (m.title ILIKE $2 OR m.body ILIKE $2)${access}
     ORDER BY CASE
       WHEN lower(m.title) = lower($3) THEN 0
       WHEN m.title ILIKE $4 THEN 1
       WHEN m.title ILIKE $2 THEN 2
       ELSE 3 END, m.created_at DESC
     LIMIT 20`,
    params,
  );
  return r.rows as GlobalMessageHit[];
}

/** Knowledge notes (title/body) within the workspace. */
export async function searchKnowledgeGlobal(
  workspaceId: number,
  q: string,
  viewerUserId?: number,
): Promise<GlobalKnowledgeHit[]> {
  if (q.trim() === "") return [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  let access = "";
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    access = searchAccessClause(viewerUserId, params.length);
  }
  const r = await db.query(
    `SELECT k.id, k.title, k.body, k.updated_at::text AS updated_at,
       p.id AS project_id, p.name AS project_name
     FROM project_knowledge k JOIN projects p ON p.id = k.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL
       AND (k.title ILIKE $2 OR k.body ILIKE $2)${access}
     ORDER BY CASE
       WHEN lower(k.title) = lower($3) THEN 0
       WHEN k.title ILIKE $4 THEN 1
       WHEN k.title ILIKE $2 THEN 2
       ELSE 3 END, k.updated_at DESC
     LIMIT 20`,
    params,
  );
  return r.rows as GlobalKnowledgeHit[];
}

/** Attachment file names within the workspace. */
export async function searchFilesGlobal(
  workspaceId: number,
  q: string,
  viewerUserId?: number,
): Promise<GlobalFileHit[]> {
  if (q.trim() === "") return [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const params: unknown[] = [workspaceId, `%${escaped}%`, q, `${escaped}%`];
  let access = "";
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    access = searchAccessClause(viewerUserId, params.length);
  }
  const r = await db.query(
    `SELECT a.id, a.file_name, a.mime_type, a.created_at::text AS created_at,
       t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name
     FROM task_attachments a
     JOIN tasks t ON t.id = a.task_id AND t.deleted_at IS NULL
     JOIN projects p ON p.id = t.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND a.file_name ILIKE $2${access}
     ORDER BY CASE
       WHEN lower(a.file_name) = lower($3) THEN 0
       WHEN a.file_name ILIKE $4 THEN 1
       ELSE 2 END, a.created_at DESC
     LIMIT 20`,
    params,
  );
  return r.rows as GlobalFileHit[];
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
  viewerUserId?: number,
): Promise<SearchCustomField[]> {
  const params: unknown[] = [workspaceId];
  let access = "";
  if (viewerUserId !== undefined) {
    params.push(viewerUserId);
    access = ` AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $2 AND ux.is_admin)
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2))`;
  }
  const r = await db.query(
    `SELECT f.id, f.name, f.field_type, f.options, p.name AS project_name
     FROM custom_fields f JOIN projects p ON p.id = f.project_id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND f.deleted_at IS NULL${access}
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

