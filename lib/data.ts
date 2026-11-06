import { db } from "./db";
import { DEFAULT_WIDGETS, normalizeWidgets } from "./dashboard-widgets";

import type { CustomField, CustomValue } from "./custom-fields";
import type { FormField, ProjectForm } from "./forms";
import type { ProjectApp } from "./integrations";
import type { Bundle, BundleField } from "./bundles";
import type { ProjectAutomation } from "./automations";
import { normalizeProjectRole, type ProjectRole } from "./project-roles";
export type { CustomField, CustomValue } from "./custom-fields";

// Demo single-user (slice 1): all writes are attributed to user 1.
export const CURRENT_USER_ID = 1;
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
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  status_color?: string | null;
  status_options: string[];
  status_field_name: string;
  status_field_enabled: boolean;
  color?: string | null;
  icon?: string | null;
  email_address?: string | null;
  email_enabled?: boolean;
};

export type Section = { id: number; name: string; position: number };

export type TaskRow = {
  id: number;
  project_id: number | null;
  section_id: number | null;
  parent_task_id: number | null;
  name: string;
  description: string;
  assignee_id: number | null;
  assignee_name: string | null;
  created_by: number | null;
  creator_name: string | null;
  completed: boolean;
  completed_at: string | null;
  start_on: string | null;
  due_on: string | null;
  progress: number;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
  recurrence: string;
  comment_count: number;
  subtask_count: number;
  eff_section_id?: number | null;
};

export type CommentRow = {
  id: number;
  author_id: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
};

const TASK_COLS = `
  t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
  t.assignee_id, u.name AS assignee_name, t.created_by, cu.name AS creator_name, t.completed,
  t.completed_at::text AS completed_at,
  t.start_on::text, t.due_on::text, t.progress, t.status, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at, t.recurrence,
  (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN users cu ON cu.id = t.created_by
`;

export async function getWorkspace() {
  const r = await db.query("SELECT id, name FROM workspaces ORDER BY id LIMIT 1");
  return r.rows[0] as { id: number; name: string } | undefined;
}

export async function getProjects(workspaceId: number): Promise<Project[]> {
  const r = await db.query(
    "SELECT id, name, status, status_options, color, icon FROM projects WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY id",
    [workspaceId],
  );
  return r.rows;
}

export async function getUsers(): Promise<User[]> {
  const r = await db.query(
    `SELECT id, name, email, title, avatar_url, is_guest, is_admin, deactivated_at::text AS deactivated_at
     FROM users WHERE deactivated_at IS NULL ORDER BY id`,
  );
  return r.rows;
}

/** Projects visible to a user: workspace admins see all, others only member projects. */
/** Search assignee options: guests only see themselves and collaborators. */
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

export async function getProjectsForUser(workspaceId: number, userId: number): Promise<Project[]> {
  const r = await db.query(
    `SELECT p.id, p.name, p.status, COALESCE(p.status_options, '[]'::jsonb) AS status_options,
       p.color, p.icon
     FROM projects p
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)
       )
     ORDER BY p.id`,
    [workspaceId, userId],
  );
  return r.rows;
}

/** Effective project role; workspace admins are project admins everywhere. */
export async function getProjectAccess(
  userId: number,
  projectId: number,
): Promise<{ workspaceAdmin: boolean; role: ProjectRole | null }> {
  const r = await db.query(
    `SELECT u.is_admin, u.deactivated_at, m.role
     FROM users u
     LEFT JOIN project_members m ON m.project_id = $2 AND m.user_id = u.id
     WHERE u.id = $1`,
    [userId, projectId],
  );
  if (r.rowCount === 0 || r.rows[0].deactivated_at !== null) {
    return { workspaceAdmin: false, role: null };
  }
  const workspaceAdmin = r.rows[0].is_admin === true;
  return {
    workspaceAdmin,
    role: workspaceAdmin ? "admin" : normalizeProjectRole(r.rows[0].role),
  };
}

export async function getProject(projectId: number) {
  const r = await db.query(
    "SELECT id, name, description, status, status_color, COALESCE(status_options, '[]'::jsonb) AS status_options, status_field_name, status_field_enabled, color, icon, email_address, email_enabled FROM projects WHERE id = $1",
    [projectId],
  );
  return r.rows[0] as Project | undefined;
}

export async function getSections(projectId: number): Promise<Section[]> {
  const r = await db.query(
    "SELECT id, name, position FROM sections WHERE project_id = $1 ORDER BY position, id",
    [projectId],
  );
  return r.rows;
}

export async function getProjectTasks(projectId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
  t.assignee_id, u.name AS assignee_name, t.created_by, cu.name AS creator_name, t.completed,
  t.completed_at::text AS completed_at,
  t.start_on::text, t.due_on::text, t.progress, t.status, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at, t.recurrence,
  (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
  COALESCE(m.section_id, t.section_id) AS eff_section_id
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN users cu ON cu.id = t.created_by
     LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1
     WHERE t.parent_task_id IS NULL AND t.deleted_at IS NULL AND (t.project_id = $1 OR m.task_id IS NOT NULL)
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return r.rows;
}

export async function getTask(taskId: number) {
  const r = await db.query(`SELECT ${TASK_COLS} WHERE t.id = $1 AND t.deleted_at IS NULL`, [taskId]);
  return r.rows[0] as TaskRow | undefined;
}

export async function getSubtasks(taskId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT ${TASK_COLS} WHERE t.parent_task_id = $1 AND t.deleted_at IS NULL ORDER BY t.position, t.id`,
    [taskId],
  );
  return r.rows;
}

export async function getComments(taskId: number): Promise<CommentRow[]> {
  const r = await db.query(
    `SELECT c.id, c.author_id, u.name AS author_name, c.body, c.created_at::text,
       c.edited_at::text AS edited_at
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.task_id = $1 ORDER BY c.id`,
    [taskId],
  );
  return r.rows;
}

export type TaskEventRow = {
  id: number;
  summary: string;
  actor_name: string | null;
  created_at: string;
};

export async function getTaskEvents(taskId: number): Promise<TaskEventRow[]> {
  const r = await db.query(
    `SELECT e.id, e.summary, u.name AS actor_name, e.created_at::text
     FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.task_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
    [taskId],
  );
  return r.rows;
}

export async function getMyTasks(userId: number): Promise<(TaskRow & { project_name: string | null })[]> {
  const r = await db.query(
    `SELECT t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
       t.assignee_id, u.name AS assignee_name, t.completed,
       t.start_on::text, t.due_on::text, t.progress, t.status, t.position, t.updated_at::text AS updated_at, t.recurrence,
       (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
       (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
       p.name AS project_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN my_task_orders o ON o.task_id = t.id AND o.user_id = $1
     WHERE t.assignee_id = $1 AND t.completed = FALSE AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY o.position NULLS LAST, t.due_on NULLS LAST, t.position, t.id`,
    [userId],
  );
  return r.rows;
}

export async function getDependencies(taskId: number) {
  const r = await db.query(
    "SELECT t.id, t.name FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = $1 ORDER BY t.id",
    [taskId],
  );
  return r.rows as { id: number; name: string }[];
}

export async function getProjectTaskOptions(projectId: number) {  const r = await db.query(
    "SELECT id, name FROM tasks WHERE project_id = $1 AND parent_task_id IS NULL AND deleted_at IS NULL ORDER BY position, id",
    [projectId],
  );
  return r.rows as { id: number; name: string }[];
}

export type ProjectStats = {
  total: number;
  done: number;
  overdue: number;
  dueWeek: number;
  bySection: { id: number; name: string; total: number; done: number }[];
  byAssignee: { id: number; name: string; open: number }[];
  upcoming: { id: number; name: string; due_on: string | null; assignee_name: string | null }[];
  recent: { id: number; name: string; updated_at: string }[];
};

export type ProjectActivity = {
  kind: "comment" | "event";
  id: number;
  summary: string;
  actor_name: string | null;
  created_at: string;
};

export async function getProjectActivity(projectId: number, limit = 8): Promise<ProjectActivity[]> {
  const r = await db.query(
    `SELECT * FROM (
       SELECT 'comment'::text AS kind, c.id, c.body AS summary, c.created_at::text AS created_at,
         u.name AS actor_name
       FROM comments c
       JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
       LEFT JOIN users u ON u.id = c.author_id
       WHERE t.project_id = $1
       UNION ALL
       SELECT 'event'::text AS kind, e.id, e.summary, e.created_at::text AS created_at,
         u.name AS actor_name
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE t.project_id = $1
     ) feed
     ORDER BY created_at DESC LIMIT $2`,
    [projectId, limit],
  );
  return r.rows as ProjectActivity[];
}

export type ProjectMessage = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  author_name: string | null;
};

export type ProjectTab = {
  id: number;
  tab_key: string;
  name: string;
  view_type: string;
  position: number;
  is_custom: boolean;
};

export const DEFAULT_PROJECT_TABS = [
  { key: "builtin:overview", name: "概要", view: "overview" },
  { key: "builtin:dashboard", name: "ダッシュボード", view: "dashboard" },
  { key: "builtin:list", name: "リスト", view: "list" },
  { key: "builtin:board", name: "ボード", view: "board" },
  { key: "builtin:timeline", name: "タイムライン", view: "timeline" },
  { key: "builtin:calendar", name: "カレンダー", view: "calendar" },
  { key: "builtin:messages", name: "メッセージ", view: "messages" },
  { key: "builtin:knowledge", name: "知識", view: "knowledge" },
  { key: "builtin:files", name: "ファイル", view: "files" },
  { key: "builtin:forms", name: "フォーム", view: "forms" },
] as const;

export async function getProjectTabs(projectId: number): Promise<ProjectTab[]> {
  const existing = await db.query(
    "SELECT id, tab_key, name, view_type, position, is_custom FROM project_tabs WHERE project_id = $1 ORDER BY position, id",
    [projectId],
  );
  if (existing.rowCount === 0) {
    for (const [index, tab] of DEFAULT_PROJECT_TABS.entries()) {
      await db.query(
        `INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (project_id, tab_key) DO NOTHING`,
        [projectId, tab.key, tab.name, tab.view, index * 1000],
      );
    }
    return (
      await db.query(
        "SELECT id, tab_key, name, view_type, position, is_custom FROM project_tabs WHERE project_id = $1 ORDER BY position, id",
        [projectId],
      )
    ).rows;
  }
  const present = new Set(existing.rows.map((row) => row.tab_key));
  const missing = DEFAULT_PROJECT_TABS.filter((tab) => !present.has(tab.key));
  if (missing.length > 0) {
    const max = await db.query(
      "SELECT COALESCE(MAX(position), 0) AS position FROM project_tabs WHERE project_id = $1",
      [projectId],
    );
    let next = Number(max.rows[0].position) + 1000;
    for (const tab of missing) {
      await db.query(
        `INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (project_id, tab_key) DO NOTHING`,
        [projectId, tab.key, tab.name, tab.view, next],
      );
      next += 1000;
    }
    return (
      await db.query(
        "SELECT id, tab_key, name, view_type, position, is_custom FROM project_tabs WHERE project_id = $1 ORDER BY position, id",
        [projectId],
      )
    ).rows;
  }
  return existing.rows;
}

export async function getProjectAutomations(projectId: number): Promise<ProjectAutomation[]> {
  const r = await db.query(
    `SELECT id, project_id, name, trigger, action_type, action_value, enabled,
            created_at::text AS created_at, updated_at::text AS updated_at
     FROM project_automations WHERE project_id = $1 ORDER BY id`,
    [projectId],
  );
  return r.rows as ProjectAutomation[];
}

export async function getBundlesForProject(projectId: number): Promise<Bundle[]> {
  const r = await db.query(
    `SELECT b.id, b.workspace_id, b.name, b.description, b.fields,
            b.created_at::text AS created_at, b.updated_at::text AS updated_at,
            EXISTS (SELECT 1 FROM bundle_applications ba WHERE ba.bundle_id = b.id AND ba.project_id = $1) AS applied,
            (SELECT COUNT(*)::int FROM bundle_applications ba WHERE ba.bundle_id = b.id) AS applied_count
     FROM bundles b
     JOIN projects p ON p.workspace_id = b.workspace_id
     WHERE p.id = $1
     ORDER BY b.id`,
    [projectId],
  );
  return r.rows.map((row) => ({
    ...row,
    fields: (row.fields ?? []) as BundleField[],
    applied: row.applied === true,
    applied_count: Number(row.applied_count ?? 0),
  }));
}

export async function getProjectApps(projectId: number): Promise<ProjectApp[]> {
  const r = await db.query(
    `SELECT id, project_id, app_key, config, enabled,
            created_at::text AS created_at, updated_at::text AS updated_at
     FROM project_apps WHERE project_id = $1 ORDER BY id`,
    [projectId],
  );
  return r.rows.map((row) => ({
    ...row,
    config: (row.config ?? {}) as Record<string, string>,
  }));
}

export async function getProjectForms(projectId: number): Promise<ProjectForm[]> {
  const r = await db.query(
    `SELECT f.id, f.project_id, f.name, f.description, f.fields, f.published,
            f.created_at::text AS created_at, f.updated_at::text AS updated_at,
            COUNT(r.id)::int AS response_count
     FROM project_forms f
     LEFT JOIN form_responses r ON r.form_id = f.id
     WHERE f.project_id = $1
     GROUP BY f.id
     ORDER BY f.id DESC`,
    [projectId],
  );
  return r.rows.map((row) => ({
    ...row,
    fields: (row.fields ?? []) as FormField[],
    response_count: Number(row.response_count ?? 0),
  }));
}

export type ProjectKnowledge = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_name: string | null;
};

export async function getProjectKnowledge(projectId: number): Promise<ProjectKnowledge[]> {
  const r = await db.query(
    `SELECT k.id, k.title, k.body, k.created_at::text AS created_at,
            k.updated_at::text AS updated_at, u.name AS author_name
     FROM project_knowledge k LEFT JOIN users u ON u.id = k.author_id
     WHERE k.project_id = $1 ORDER BY k.updated_at DESC, k.id DESC LIMIT 100`,
    [projectId],
  );
  return r.rows;
}

export async function getProjectMessages(projectId: number): Promise<ProjectMessage[]> {
  const r = await db.query(
    `SELECT m.id, m.title, m.body, m.created_at::text AS created_at, u.name AS author_name
     FROM project_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.project_id = $1 ORDER BY m.id DESC LIMIT 100`,
    [projectId],
  );
  return r.rows;
}


export async function getCustomFields(projectId: number): Promise<CustomField[]> {
  const r = await db.query(
    "SELECT id, name, field_type, options FROM custom_fields WHERE project_id = $1 ORDER BY position, id",
    [projectId],
  );
  return r.rows.map((row) => ({ ...row, options: (row.options ?? []) as string[] }));
}

export async function getTaskCustomValues(
  projectId: number,
): Promise<Record<number, Record<number, CustomValue>>> {
  const r = await db.query(
    `SELECT v.task_id, v.field_id, v.value_text, v.value_number
     FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
     WHERE f.project_id = $1`,
    [projectId],
  );
  const out: Record<number, Record<number, CustomValue>> = {};
  for (const row of r.rows) {
    if (!out[row.task_id]) out[row.task_id] = {};
    out[row.task_id][row.field_id] = { value_text: row.value_text, value_number: row.value_number };
  }
  return out;
}

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

export async function getTaskAttachments(taskId: number): Promise<Attachment[]> {
  const r = await db.query(
    `SELECT a.id, a.task_id, a.file_name, a.mime_type, a.size_bytes::int AS size_bytes,
       u.name AS author_name, a.created_at::text AS created_at
     FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.task_id = $1 ORDER BY a.id`,
    [taskId],
  );
  return r.rows;
}

export async function getProjectAttachments(projectId: number): Promise<Attachment[]> {
  const r = await db.query(
    `SELECT a.id, a.task_id, t.name AS task_name, a.file_name, a.mime_type,
       a.size_bytes::int AS size_bytes, u.name AS author_name, a.created_at::text AS created_at
     FROM task_attachments a JOIN tasks t ON t.id = a.task_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE t.project_id = $1 OR EXISTS
       (SELECT 1 FROM task_project_memberships m WHERE m.task_id = t.id AND m.project_id = $1)
     ORDER BY a.id DESC LIMIT 200`,
    [projectId],
  );
  return r.rows;
}

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

export type SavedView = {
  id: number;
  name: string;
  view_type: string;
  filters: { hide_completed?: boolean; assignee?: string; status?: string; due?: string };
  sort_key: string;
  group_by: string;
};

export async function getSavedViews(projectId: number): Promise<SavedView[]> {
  const r = await db.query(
    "SELECT id, name, view_type, filters, sort_key, group_by FROM saved_views WHERE project_id = $1 ORDER BY id",
    [projectId],
  );
  return r.rows.map((row) => ({ ...row, filters: (row.filters ?? {}) as SavedView["filters"] }));
}

export async function getSavedView(id: number): Promise<(SavedView & { project_id: number }) | undefined> {
  const r = await db.query(
    "SELECT id, project_id, name, view_type, filters, sort_key, group_by FROM saved_views WHERE id = $1",
    [id],
  );
  if (r.rowCount === 0) return undefined;
  const row = r.rows[0];
  return { ...row, filters: (row.filters ?? {}) as SavedView["filters"] };
}

export type DashboardExtras = {
  statusFieldEnabled: boolean;
  byStatus: { status: string; n: number }[];
  overdue: { id: number; name: string; due_on: string | null; assignee_name: string | null }[];
  trend: { day: string; n: number }[];
};

export async function getDashboardExtras(projectId: number, days = 14): Promise<DashboardExtras> {
  const window = [7, 14, 30].includes(days) ? days : 14;
  const project = await db.query(
    "SELECT status_field_enabled FROM projects WHERE id = $1",
    [projectId],
  );
  const statusFieldEnabled = project.rows[0]?.status_field_enabled !== false;
  const byStatus = statusFieldEnabled
    ? await db.query(
        `SELECT status, COUNT(*)::int AS n FROM tasks
         WHERE project_id = $1 AND parent_task_id IS NULL AND deleted_at IS NULL GROUP BY status ORDER BY n DESC, status`,
        [projectId],
      )
    : { rows: [] as { status: string; n: number }[] };
  const overdue = await db.query(
    `SELECT t.id, t.name, t.due_on::text AS due_on, u.name AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1 AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed AND t.due_on < CURRENT_DATE
     ORDER BY t.due_on LIMIT 20`,
    [projectId],
  );
  const trend = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(e.id)::int AS n
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d
     LEFT JOIN task_events e ON e.kind = 'completed' AND e.created_at::date = d::date
       AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = e.task_id AND t.project_id = $1 AND t.deleted_at IS NULL)
     GROUP BY d ORDER BY d`,
    [projectId, window],
  );
  return { statusFieldEnabled, byStatus: byStatus.rows, overdue: overdue.rows, trend: trend.rows };
}

export async function getTaskDependencies(projectId: number) {
  const r = await db.query(
    `SELECT d.task_id, d.depends_on_id FROM task_dependencies d
     JOIN tasks t ON t.id = d.task_id WHERE t.project_id = $1`,
    [projectId],
  );
  return r.rows as { task_id: number; depends_on_id: number }[];
}

export type TaskTemplate = {
  id: number;
  name: string;
  title_template: string;
  description: string;
  assignee_id: number | null;
  assignee_name: string | null;
  due_offset_days: number | null;
  section_id: number | null;
  section_name: string | null;
  subtasks: { name: string }[];
};

export async function getTaskTemplates(projectId: number): Promise<TaskTemplate[]> {
  const r = await db.query(
    `SELECT t.id, t.name, t.title_template, t.description, t.assignee_id,
       u.name AS assignee_name, t.due_offset_days, t.section_id, s.name AS section_name,
       t.subtasks
     FROM task_templates t
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN sections s ON s.id = t.section_id
     WHERE t.project_id = $1 ORDER BY t.id`,
    [projectId],
  );
  return r.rows.map((row) => ({
    ...row,
    subtasks: (Array.isArray(row.subtasks) ? row.subtasks : [])
      .filter((x: unknown) => typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string")
      .map((x: { name: string }) => ({ name: x.name.slice(0, 255) })),
  }));
}

export async function getProjectTemplateList(workspaceId: number) {
  const r = await db.query(
    "SELECT id, name FROM project_templates WHERE workspace_id = $1 ORDER BY id",
    [workspaceId],
  );
  return r.rows as { id: number; name: string }[];
}

export async function getProjectMembers(projectId: number): Promise<User[]> {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest,
       u.deactivated_at::text AS deactivated_at, m.role
     FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 ORDER BY u.id`,
    [projectId],
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

export type CommentReactions = Record<number, { emoji: string; n: number; mine: boolean }[]>;

export async function getArchivedProjects(workspaceId: number) {
  const r = await db.query(
    `SELECT id, name, archived_at::text AS archived_at FROM projects
     WHERE workspace_id = $1 AND archived_at IS NOT NULL ORDER BY archived_at DESC`,
    [workspaceId],
  );
  return r.rows as { id: number; name: string; archived_at: string }[];
}

export async function getCommentReactions(taskId: number, userId: number | null): Promise<CommentReactions> {
  const r = await db.query(
    `SELECT r.comment_id, r.emoji, COUNT(*)::int AS n,
       BOOL_OR(r.user_id = $2) AS mine
     FROM comment_reactions r JOIN comments c ON c.id = r.comment_id
     WHERE c.task_id = $1 GROUP BY r.comment_id, r.emoji ORDER BY n DESC, r.emoji`,
    [taskId, userId],
  );
  const out: CommentReactions = {};
  for (const row of r.rows as { comment_id: number; emoji: string; n: number; mine: boolean }[]) {
    if (!out[row.comment_id]) out[row.comment_id] = [];
    out[row.comment_id].push({ emoji: row.emoji, n: row.n, mine: row.mine });
  }
  return out;
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

export async function touchRecentProject(userId: number | null, projectId: number) {
  if (userId === null) return;
  await db.query(
    `INSERT INTO user_recent_projects (user_id, project_id, opened_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, project_id) DO UPDATE SET opened_at = now()`,
    [userId, projectId],
  ).catch(() => undefined);
}

export async function getRecentProjects(userId: number | null) {
  if (userId === null) return [];
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon FROM user_recent_projects r JOIN projects p ON p.id = r.project_id
     WHERE r.user_id = $1 AND p.archived_at IS NULL ORDER BY r.opened_at DESC LIMIT 5`,
    [userId],
  );
  return r.rows as { id: number; name: string; color: string | null; icon: string | null }[];
}

export async function getDashboardPrefs(userId: number | null, projectId: number) {
  if (userId === null) return DEFAULT_WIDGETS;
  const r = await db.query("SELECT widgets FROM dashboard_prefs WHERE user_id = $1 AND project_id = $2", [
    userId,
    projectId,
  ]);
  if (r.rowCount === 0) return DEFAULT_WIDGETS;
  return normalizeWidgets(r.rows[0].widgets);
}

export async function getSubtasksBulk(projectId: number): Promise<Record<number, TaskRow[]>> {
  const r = await db.query(
    `SELECT t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
       t.assignee_id, u.name AS assignee_name, t.completed,
       t.start_on::text, t.due_on::text, t.progress, t.status, t.position, t.updated_at::text AS updated_at, t.recurrence,
       (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
       (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1 AND t.parent_task_id IS NOT NULL AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [projectId],
  );
  const out: Record<number, TaskRow[]> = {};
  for (const row of r.rows as TaskRow[]) {
    const k = row.parent_task_id as number;
    if (!out[k]) out[k] = [];
    out[k].push(row);
  }
  return out;
}

export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const totals = await db.query(
    `SELECT COUNT(*) FILTER (WHERE parent_task_id IS NULL)::int AS total,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND completed)::int AS done,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on < CURRENT_DATE)::int AS overdue,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_week
     FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
    [projectId],
  );
  const bySection = await db.query(
    `SELECT s.id, s.name, COUNT(t.id)::int AS total,
       COUNT(t.id) FILTER (WHERE t.completed)::int AS done
     FROM sections s LEFT JOIN tasks t ON t.section_id = s.id AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     WHERE s.project_id = $1 GROUP BY s.id ORDER BY s.position, s.id`,
    [projectId],
  );
  const byAssignee = await db.query(
    `SELECT u.id, u.name, COUNT(t.id)::int AS open
     FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1 AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed
     GROUP BY u.id ORDER BY 3 DESC, u.id`,
    [projectId],
  );
  const upcoming = await db.query(
    `SELECT t.id, t.name, t.due_on::text AS due_on, u.name AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1 AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed AND t.due_on IS NOT NULL
     ORDER BY t.due_on LIMIT 7`,
    [projectId],
  );
  const recent = await db.query(
    `SELECT id, name, updated_at::text AS updated_at FROM tasks
     WHERE project_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5`,
    [projectId],
  );
  return {
    total: totals.rows[0].total,
    done: totals.rows[0].done,
    overdue: totals.rows[0].overdue,
    dueWeek: totals.rows[0].due_week,
    bySection: bySection.rows,
    byAssignee: byAssignee.rows,
    upcoming: upcoming.rows,
    recent: recent.rows,
  };
}

export async function searchTasks(workspaceId: number, q: string) {
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const r = await db.query(
    `SELECT t.id, t.name, t.completed, t.due_on::text AS due_on, p.id AS project_id, p.name AS project_name
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE p.workspace_id = $1 AND t.deleted_at IS NULL AND (t.name ILIKE $2 OR t.description ILIKE $2)
     ORDER BY t.updated_at DESC LIMIT 50`,
    [workspaceId, like],
  );
  return r.rows as {
    id: number;
    name: string;
    completed: boolean;
    due_on: string | null;
    project_id: number;
    project_name: string;
  }[];
}

export async function logEvent(taskId: number, actorId: number, kind: string, summary: string) {
  await db.query(
    "INSERT INTO task_events (task_id, actor_id, kind, summary) VALUES ($1, $2, $3, $4)",
    [taskId, actorId, kind, summary],
  );
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
          AND (EXISTS (SELECT 1 FROM users ux WHERE ux.id = $1 AND ux.is_admin)
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))
          AND (e.actor_id IS NULL OR e.actor_id <> $1))
       AS n`,
    [userId, workspaceId],
  );
  return r.rows[0].n as number;
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
  return r.rows as {
    id: number;
    name: string;
    completed: boolean;
    due_on: string | null;
    assignee_name: string | null;
    project_id: number;
    project_name: string;
  }[];
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

export type ViewState = Record<string, string | number | boolean | null>;

const VIEW_STATE_KEYS = new Set(["list", "board", "timeline", "calendar"]);

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
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL${access}
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

export async function recentComments(workspaceId: number, limit = 50) {
  const r = await db.query(
    `SELECT c.id, c.body, c.created_at::text AS created_at, u.name AS author_name,
       t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name
     FROM comments c JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = c.author_id
     WHERE p.workspace_id = $1 AND t.deleted_at IS NULL
     ORDER BY c.id DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return r.rows as {
    id: number;
    body: string;
    created_at: string;
    author_name: string | null;
    task_id: number;
    task_name: string;
    project_id: number;
    project_name: string;
  }[];
}

export async function getTaskProjects(taskId: number) {  const r = await db.query(
    `SELECT p.id, p.name, s.name AS section_name
     FROM task_project_memberships m
     JOIN projects p ON p.id = m.project_id
     LEFT JOIN sections s ON s.id = m.section_id
     WHERE m.task_id = $1
     UNION
     SELECT p.id, p.name, s.name AS section_name
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN sections s ON s.id = t.section_id
     WHERE t.id = $1 AND t.project_id IS NOT NULL`,
    [taskId],
  );
  return r.rows as { id: number; name: string; section_name: string | null }[];
}
