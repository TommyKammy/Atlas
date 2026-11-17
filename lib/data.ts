import { getDirectoryUsers } from "./repositories/users";
import { projectDataAccess } from "./data-actor";
import { cache } from "react";
import { db } from "./db";
import type { RichTextDoc } from "./rich-text-types";

export type { CustomField, CustomValue } from "./custom-fields";
export * from "./repositories/tasks";
export * from "./repositories/comments";
export * from "./repositories/search";
export * from "./repositories/projects";

export type User = {
  id: number;
  name: string;
  email?: string | null;
  title?: string | null;
  avatar_url?: string | null;
  is_guest: boolean;
  is_admin?: boolean;
  deactivated_at?: string | null;
  open_tasks?: number;
  role?: string | null;
  role_id?: number | null;
  role_key?: string | null;
  role_name?: string | null;
  totp_enabled?: boolean;
};



export type CommentRow = {
  id: number;
  author_id: number | null;
  author_name: string | null;
  body: string;
  body_doc?: RichTextDoc | null;
  created_at: string;
  edited_at: string | null;
};



/** Request-scoped cache: shared by the sidebar and page components. */
export const getWorkspace = cache(async () => {
  const r = await db.query("SELECT id, name FROM workspaces ORDER BY id LIMIT 1");
  return r.rows[0] as { id: number; name: string } | undefined;
});


export const getUsers = cache(async (viewerId: number | null): Promise<User[]> => {
  if (viewerId === null) return [];
  const ws = await getWorkspace();
  return ws ? getDirectoryUsers(ws.id, viewerId) : [];
});

/** Projects visible to a user: workspace admins see all, others only member projects. */
/** Search assignee options: guests only see themselves and collaborators. */

/** Effective project role; workspace admins are project admins everywhere. */





/** Task scoped to a project the caller can already see (primary, multi-home, or subtask). */

























export type Attachment = {
  id: number;
  task_id: number;
  task_name?: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  author_name: string | null;
  created_at: string;
};



export type PortfolioRow = {
  id: number;
  name: string;
  total: number;
  done: number;
  overdue: number;
  members: number;
  min_due: string | null;
  max_due: string | null;
};

export async function getPortfolioProjects(userId: number | null) {
  if (userId === null) return [];
  const r = await db.query(
    `SELECT p.id, p.name, pp.added_at::text AS added_at
     FROM portfolio_projects pp JOIN projects p ON p.id = pp.project_id
     WHERE pp.user_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND ${projectDataAccess("p", "$1")} ORDER BY pp.added_at DESC`,
    [userId],
  );
  return r.rows as { id: number; name: string; added_at: string }[];
}

export async function getPortfolio(workspaceId: number, viewerUserId: number): Promise<PortfolioRow[]> {
  const r = await db.query(
    `SELECT p.id, p.name,
       COUNT(DISTINCT t.id) FILTER (WHERE t.parent_task_id IS NULL)::int AS total,
       COUNT(DISTINCT t.id) FILTER (WHERE t.parent_task_id IS NULL AND t.completed)::int AS done,
       COUNT(DISTINCT t.id) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed AND t.due_on < CURRENT_DATE)::int AS overdue,
       COUNT(DISTINCT m.user_id)::int AS members,
       MIN(t.due_on) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed)::text AS min_due,
       MAX(t.due_on) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed)::text AS max_due
     FROM projects p
     LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
     LEFT JOIN project_members m ON m.project_id = p.id
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL
       AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2")}
     GROUP BY p.id ORDER BY p.id`,
    [workspaceId, viewerUserId],
  );
  return r.rows;
}











export type TrashItem = {
  id: number;
  name: string;
  project_name: string | null;
  can_edit: boolean;
  deleted_at: string;
};

export async function getTrash(workspaceId: number, viewerId: number): Promise<TrashItem[]> {
  const r = await db.query(
    `SELECT t.id, t.name, visible.name AS project_name, t.deleted_at::text AS deleted_at,
       ${projectDataAccess("governing", "$2", "edit")} AS can_edit
     FROM tasks t
     LEFT JOIN projects governing ON governing.id = COALESCE(t.project_id,
       (SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id ORDER BY m.project_id LIMIT 1),
       (SELECT parent.project_id FROM tasks parent WHERE parent.id = t.parent_task_id))
     LEFT JOIN LATERAL (
       SELECT p.id, p.name FROM projects p
       WHERE p.workspace_id = $1 AND p.id IN (
         SELECT governing.id UNION ALL
         SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id
       ) AND ${projectDataAccess("p", "$2")}
       ORDER BY (p.id = governing.id) DESC, p.id LIMIT 1
     ) visible ON TRUE
     WHERE t.deleted_at IS NOT NULL AND (visible.id IS NOT NULL
       OR (governing.id IS NULL AND ${projectDataAccess("governing", "$2")}))
     ORDER BY t.deleted_at DESC LIMIT 200`,
    [workspaceId, viewerId],
  );
  return r.rows;
}




export async function getFavorites(userId: number) {
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon FROM user_favorites f JOIN projects p ON p.id = f.project_id
     WHERE f.user_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND ${projectDataAccess("p", "$1")} ORDER BY p.id`,
    [userId],
  );
  return r.rows as { id: number; name: string; color: string | null; icon: string | null }[];
}

export async function isFavorite(userId: number | null, projectId: number): Promise<boolean> {
  if (userId === null) return false;
  const r = await db.query("SELECT 1 FROM user_favorites WHERE user_id = $1 AND project_id = $2", [
    userId,
    projectId,
  ]);
  return (r.rowCount ?? 0) > 0;
}








export { getInbox, getInboxPage, getUnreadCount } from "./notification-feed";
export type { InboxItem, InboxPage } from "./notification-feed";


export type ViewState = Record<string, string | number | boolean | null>;

const VIEW_STATE_KEYS = new Set(["list", "board", "timeline", "calendar", "tabs"]);

export async function getProjectViewStates(
  userId: number,
  projectId: number,
): Promise<Record<string, ViewState>> {
  const r = await db.query(
    "SELECT view, state FROM project_view_states WHERE user_id = $1 AND project_id = $2",
    [userId, projectId],
  );
  const out: Record<string, ViewState> = {};
  for (const row of r.rows) {
    if (VIEW_STATE_KEYS.has(row.view) && row.state && typeof row.state === "object") {
      out[row.view] = row.state as ViewState;
    }
  }
  return out;
}

export async function saveProjectViewState(
  userId: number,
  projectId: number,
  view: string,
  state: ViewState,
): Promise<void> {
  if (!VIEW_STATE_KEYS.has(view)) return;
  await db.query(
    `INSERT INTO project_view_states (user_id, project_id, view, state, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (user_id, project_id, view)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [userId, projectId, view, JSON.stringify(state)],
  );
}

export type OutOfOffice = {
  from: string | null;
  to: string | null;
  note: string | null;
};

export async function getOutOfOffice(userId: number): Promise<OutOfOffice> {
  const r = await db.query(
    "SELECT out_of_office_from::text AS from, out_of_office_to::text AS to, out_of_office_note AS note FROM users WHERE id = $1",
    [userId],
  );
  return (r.rows[0] as OutOfOffice | undefined) ?? { from: null, to: null, note: null };
}
