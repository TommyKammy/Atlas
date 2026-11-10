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


export const getUsers = cache(async (): Promise<User[]> => {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
       u.role_id, u.totp_enabled, u.deactivated_at::text AS deactivated_at,
       r.key AS role_key, r.name AS role_name
     FROM users u LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.deactivated_at IS NULL ORDER BY u.id`,
  );
  return r.rows;
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
     WHERE pp.user_id = $1 AND p.archived_at IS NULL ORDER BY pp.added_at DESC`,
    [userId],
  );
  return r.rows as { id: number; name: string; added_at: string }[];
}

export async function getPortfolio(workspaceId: number, viewerUserId?: number): Promise<PortfolioRow[]> {
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
       AND ($2::bigint IS NULL
         OR EXISTS (SELECT 1 FROM users ux WHERE ux.id = $2 AND ux.is_admin)
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2))
     GROUP BY p.id ORDER BY p.id`,
    [workspaceId, viewerUserId ?? null],
  );
  return r.rows;
}











export type TrashItem = {
  id: number;
  name: string;
  project_name: string | null;
  deleted_at: string;
};

export async function getTrash(workspaceId: number): Promise<TrashItem[]> {
  const r = await db.query(
    `SELECT t.id, t.name, p.name AS project_name, t.deleted_at::text AS deleted_at
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NOT NULL AND (p.workspace_id = $1 OR t.project_id IS NULL)
     ORDER BY t.deleted_at DESC LIMIT 200`,
    [workspaceId],
  );
  return r.rows;
}




export async function getFavorites(userId: number) {
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon FROM user_favorites f JOIN projects p ON p.id = f.project_id
     WHERE f.user_id = $1 AND p.archived_at IS NULL ORDER BY p.id`,
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








export type InboxItem = {
  entry: "comment" | "event";
  id: number;
  body: string;
  created_at: string;
  author_name: string | null;
  author_id: number | null;
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  is_read: boolean;
};

export async function getInbox(userId: number, workspaceId: number): Promise<InboxItem[]> {
  const r = await db.query(
    `SELECT * FROM (
       SELECT 'comment' AS entry, c.id, c.body, c.created_at::text AS created_at,
         u.name AS author_name, c.author_id,
         t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name,
         (r.comment_id IS NOT NULL) AS is_read
       FROM comments c JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = c.author_id
       LEFT JOIN inbox_reads r ON r.comment_id = c.id AND r.user_id = $1
       WHERE p.workspace_id = $2
         AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $1 AND ux.is_admin)
           OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))
       UNION ALL
       SELECT 'event' AS entry, e.id, e.summary AS body, e.created_at::text AS created_at,
         u.name AS author_name, e.actor_id AS author_id,
         t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name,
         (r.event_id IS NOT NULL) AS is_read
       FROM task_events e JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN inbox_reads r ON r.event_id = e.id AND r.user_id = $1
       WHERE p.workspace_id = $2
          AND (e.kind NOT LIKE 'approval_%' OR EXISTS (
            SELECT 1 FROM task_event_recipients recipient WHERE recipient.event_id = e.id AND recipient.user_id = $1
          ))
         AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $1 AND ux.is_admin)
           OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))
     ) feed ORDER BY created_at DESC LIMIT 100`,
    [userId, workspaceId],
  );
  return r.rows;
}

export async function getUnreadCount(userId: number, workspaceId: number): Promise<number> {
  const r = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM comments c JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN inbox_reads r ON r.comment_id = c.id AND r.user_id = $1
        WHERE p.workspace_id = $2 AND r.comment_id IS NULL
          AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $1 AND ux.is_admin)
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))
          AND (c.author_id IS NULL OR c.author_id <> $1))
       +
       (SELECT COUNT(*)::int FROM task_events e JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN inbox_reads r ON r.event_id = e.id AND r.user_id = $1
        WHERE p.workspace_id = $2 AND r.event_id IS NULL
          AND (e.kind NOT LIKE 'approval_%' OR EXISTS (
            SELECT 1 FROM task_event_recipients recipient WHERE recipient.event_id = e.id AND recipient.user_id = $1
          ))
          AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $1 AND ux.is_admin)
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))
          AND (e.actor_id IS NULL OR e.actor_id <> $1))
       AS n`,
    [userId, workspaceId],
  );
  return r.rows[0].n as number;
}


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
