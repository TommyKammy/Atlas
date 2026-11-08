import { cache } from "react";
import { db } from "../db";
import { normalizeProjectRole, type ProjectRole } from "../project-roles";
import { DEFAULT_WIDGETS, normalizeWidgets } from "../dashboard-widgets";
import { normalizeCustomFieldConfig } from "../custom-fields";
import type { FormField, ProjectForm } from "../forms";
import type { ProjectApp } from "../integrations";
import type { Bundle, BundleField } from "../bundles";
import type { ProjectAutomation } from "../automations";
import type { CustomField } from "../custom-fields";
import type { Attachment, User } from "../data";
import type { RichTextDoc } from "../rich-text-types";
import { projectTaskScope } from "./scope";

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
  description_doc?: RichTextDoc | null;
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
  project_name?: string | null;
  like_count?: number;
  comment_count: number;
  subtask_count: number;
  attachment_count?: number;
  blocked_by_count?: number;
  blocking_count?: number;
  collaborators?: { id: number; name: string }[];
  eff_section_id?: number | null;
};

export async function getProjects(workspaceId: number): Promise<Project[]> {
  const r = await db.query(
    "SELECT id, name, status, status_options, color, icon FROM projects WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY id",
    [workspaceId],
  );
  return r.rows;
}

export const getProjectsForUser = cache(async (workspaceId: number, userId: number): Promise<Project[]> => {
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
});

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
       WHERE ${projectTaskScope("t")}
       UNION ALL
       SELECT 'event'::text AS kind, e.id, e.summary, e.created_at::text AS created_at,
         u.name AS actor_name
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE ${projectTaskScope("t")}
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
  icon: string | null;
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

/** Seed the default tabs for a newly created project (idempotent). */
export async function ensureDefaultProjectTabs(
  projectId: number,
  q: { query: (text: string, params?: unknown[]) => Promise<unknown> } = db,
): Promise<void> {
  for (const [index, tab] of DEFAULT_PROJECT_TABS.entries()) {
    await q.query(
      `INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (project_id, tab_key) DO NOTHING`,
      [projectId, tab.key, tab.name, tab.view, index * 1000],
    );
  }
}

/** Pure read: seeding happens on project creation, not during page render. */
export async function getProjectTabs(projectId: number): Promise<ProjectTab[]> {
  const r = await db.query(
    "SELECT id, tab_key, name, view_type, position, is_custom, icon FROM project_tabs WHERE project_id = $1 ORDER BY position, id",
    [projectId],
  );
  if (r.rowCount === 0) {
    return DEFAULT_PROJECT_TABS.map((tab, index) => ({
      id: -(index + 1),
      tab_key: tab.key,
      name: tab.name,
      view_type: tab.view,
      position: index * 1000,
      is_custom: false,
      icon: null,
    }));
  }
  return r.rows as ProjectTab[];
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
    `SELECT id, name, field_type, options, description, config, access_level, editor_ids
     FROM custom_fields WHERE project_id = $1 AND deleted_at IS NULL ORDER BY position, id`,
    [projectId],
  );
  return r.rows.map((row) => ({
    ...row,
    options: (row.options ?? []) as string[],
    description: row.description ?? "",
    config: normalizeCustomFieldConfig(row.config),
    access_level: row.access_level ?? "everyone",
    editor_ids: Array.isArray(row.editor_ids) ? row.editor_ids.map(Number) : [],
  }));
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

export type SavedView = {
  id: number;
  name: string;
  view_type: string;
  filters: {
    hide_completed?: boolean;
    completed_only?: boolean;
    mine_only?: boolean;
    assignee?: string;
    status?: string;
    due?: string;
    start?: string;
    creator?: string;
    created?: string;
    updated?: string;
    completed_on?: string;
    group2?: string;
    groupdir?: string;
    subtasks_collapsed?: boolean;
  };
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
  const [project, byStatus, overdue, trend] = await Promise.all([
    db.query("SELECT status_field_enabled FROM projects WHERE id = $1", [projectId]),
    db.query(
      `SELECT t.status, COUNT(*)::int AS n FROM tasks t
       WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
       GROUP BY t.status ORDER BY n DESC, t.status`,
      [projectId],
    ),
    db.query(
      `SELECT t.id, t.name, t.due_on::text AS due_on, u.name AS assignee_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed AND t.due_on < CURRENT_DATE
       ORDER BY t.due_on LIMIT 20`,
      [projectId],
    ),
    db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(e.id)::int AS n
       FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d
       LEFT JOIN task_events e ON e.kind = 'completed' AND e.created_at::date = d::date
         AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = e.task_id AND ${projectTaskScope("t")} AND t.deleted_at IS NULL)
       GROUP BY d ORDER BY d`,
      [projectId, window],
    ),
  ]);
  const statusFieldEnabled = project.rows[0]?.status_field_enabled !== false;
  return {
    statusFieldEnabled,
    byStatus: statusFieldEnabled ? byStatus.rows : [],
    overdue: overdue.rows,
    trend: trend.rows,
  };
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

export async function getArchivedProjects(workspaceId: number) {
  const r = await db.query(
    `SELECT id, name, archived_at::text AS archived_at FROM projects
     WHERE workspace_id = $1 AND archived_at IS NOT NULL ORDER BY archived_at DESC`,
    [workspaceId],
  );
  return r.rows as { id: number; name: string; archived_at: string }[];
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

export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const [totals, bySection, byAssignee, upcoming, recent] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FILTER (WHERE parent_task_id IS NULL)::int AS total,
         COUNT(*) FILTER (WHERE parent_task_id IS NULL AND completed)::int AS done,
         COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on < CURRENT_DATE)::int AS overdue,
         COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_week
       FROM tasks t WHERE ${projectTaskScope("t")} AND t.deleted_at IS NULL`,
      [projectId],
    ),
    db.query(
      `SELECT s.id, s.name, COUNT(t.id)::int AS total,
         COUNT(t.id) FILTER (WHERE t.completed)::int AS done
       FROM sections s
       LEFT JOIN tasks t ON t.parent_task_id IS NULL AND t.deleted_at IS NULL AND (
         (t.project_id = s.project_id AND t.section_id = s.id)
         OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = s.project_id AND m.section_id = s.id
         )
       )
       WHERE s.project_id = $1 GROUP BY s.id ORDER BY s.position, s.id`,
      [projectId],
    ),
    db.query(
      `SELECT u.id, u.name, COUNT(t.id)::int AS open
       FROM tasks t JOIN users u ON u.id = t.assignee_id
       WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed
       GROUP BY u.id ORDER BY 3 DESC, u.id`,
      [projectId],
    ),
    db.query(
      `SELECT t.id, t.name, t.due_on::text AS due_on, u.name AS assignee_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL AND NOT t.completed AND t.due_on IS NOT NULL
       ORDER BY t.due_on LIMIT 7`,
      [projectId],
    ),
    db.query(
      `SELECT t.id, t.name, t.updated_at::text AS updated_at FROM tasks t
       WHERE ${projectTaskScope("t")} AND t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 5`,
      [projectId],
    ),
  ]);
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

