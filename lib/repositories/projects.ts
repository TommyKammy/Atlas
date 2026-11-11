import { cache } from "react";
import { db, type Queryable } from "../db";
import { normalizeProjectRole, type ProjectRole } from "../project-roles";
import { normalizeCustomFieldConfig } from "../custom-fields";
import type { FormField, ProjectForm } from "../forms";
import type { ProjectApp } from "../integrations";
import type { Bundle, BundleField } from "../bundles";
import type { ProjectAutomation } from "../automations";
import type { CustomField } from "../custom-fields";
import type { Attachment, User } from "../data";
import type { RichTextDoc } from "../rich-text-types";
import type { ProjectTemplateSummary } from "../project-templates";
import type { BundleRule } from "../bundles";
import { redactWebhookDefinition } from "../automation/webhook-credentials";
import {
  DEFAULT_PROJECT_TEMPLATES,
  defaultProjectTemplatePayload,
} from "../default-project-templates";
import { projectTaskScope } from "./scope";
import type { TaskApprovalSummary } from "../task-approval";

export type Project = {
  id: number;
  workspace_id?: number;
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
  owner_id?: number | null;
  team_id?: number | null;
  due_on?: string | null;
  settings?: unknown;
  archived_at?: string | null;
  deleted_at?: string | null;
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
  is_milestone: boolean;
  approval?: TaskApprovalSummary | null;
  position: number;
  created_at: string;
  updated_at: string;
  recurrence: string;
  timeline_row?: number | null;
  timeline_row_updated_at?: string | null;
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
  q: Queryable = db,
): Promise<{ workspaceAdmin: boolean; role: ProjectRole | null }> {
  const r = await q.query(
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
    `SELECT id, workspace_id, name, description, status, status_color,
       COALESCE(status_options, '[]'::jsonb) AS status_options, status_options_version, status_field_name,
       status_field_enabled, color, icon, email_address, email_enabled,
       owner_id, team_id, due_on::text AS due_on, settings,
       archived_at::text AS archived_at, deleted_at::text AS deleted_at
     FROM projects WHERE id = $1`,
    [projectId],
  );
  return r.rows[0] as (Project & { status_options_version: number }) | undefined;
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
    `SELECT b.id, b.workspace_id, b.name, b.description, b.fields, b.rules,
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
    rules: (Array.isArray(row.rules) ? row.rules as BundleRule[] : []).map((rule) => ({
      ...rule,
      definition: redactWebhookDefinition(rule.definition),
    })),
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
    sortdir?: string;
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

/** Seed or refresh the standard Atlas templates for one workspace. */
async function ensureBuiltinProjectTemplates(workspaceId: number) {
  const rows = DEFAULT_PROJECT_TEMPLATES.map((template) => ({
    name: template.name,
    payload: defaultProjectTemplatePayload(template),
    builtin_key: template.key,
    category: template.category,
  }));
  await db.query(
    `INSERT INTO project_templates (workspace_id, name, payload, is_builtin, builtin_key, category)
     SELECT $1::bigint, x.name, x.payload, TRUE, x.builtin_key, x.category
     FROM jsonb_to_recordset($2::jsonb) AS x(
       name text,
       payload jsonb,
       builtin_key text,
       category text
     )
     ON CONFLICT (workspace_id, builtin_key)
     DO UPDATE SET
       name = EXCLUDED.name,
       payload = EXCLUDED.payload,
       category = EXCLUDED.category`,
    [workspaceId, JSON.stringify(rows)],
  );
}

/** Template gallery data: project metadata plus bounded section/task previews. */
export async function getProjectTemplateSummaries(
  workspaceId: number,
): Promise<ProjectTemplateSummary[]> {
  await ensureBuiltinProjectTemplates(workspaceId);
  const r = await db.query(
    `WITH base AS (
       SELECT t.id, t.name, t.payload, t.created_by, t.created_at,
         t.is_builtin, t.builtin_key, t.category,
         CASE
           WHEN jsonb_typeof(t.payload->'sections') = 'array' THEN t.payload->'sections'
           ELSE '[]'::jsonb
         END AS sections
       FROM project_templates t
       WHERE t.workspace_id = $1::bigint
     )
     SELECT b.id, b.name,
       COALESCE(b.payload->'project'->>'description', '') AS description,
       b.payload->'project'->>'color' AS color,
       b.payload->'project'->>'icon' AS icon,
       b.created_by, u.name AS creator_name, b.created_at::text AS created_at,
       b.is_builtin, b.builtin_key, b.category,
       jsonb_array_length(b.sections)::int AS section_count,
       COALESCE((
         SELECT SUM(jsonb_array_length(
           CASE WHEN jsonb_typeof(sec->'tasks') = 'array' THEN sec->'tasks' ELSE '[]'::jsonb END
         ))
         FROM jsonb_array_elements(b.sections) sec
       ), 0)::int AS task_count,
       COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object('name', x.name, 'task_count', x.task_count)
           ORDER BY x.ord
         )
         FROM (
           SELECT sec->>'name' AS name,
             jsonb_array_length(
               CASE WHEN jsonb_typeof(sec->'tasks') = 'array' THEN sec->'tasks' ELSE '[]'::jsonb END
             ) AS task_count,
             ord
           FROM jsonb_array_elements(b.sections) WITH ORDINALITY AS s(sec, ord)
           LIMIT 8
         ) x
       ), '[]'::jsonb) AS sections,
       COALESCE((
         SELECT jsonb_agg(x.name)
         FROM (
           SELECT task->>'name' AS name
           FROM jsonb_array_elements(b.sections) sec
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(sec->'tasks') = 'array' THEN sec->'tasks' ELSE '[]'::jsonb END
           ) task
           WHERE task->>'name' IS NOT NULL
           LIMIT 8
         ) x
       ), '[]'::jsonb) AS sample_tasks
     FROM base b
     LEFT JOIN users u ON u.id = b.created_by
     ORDER BY b.is_builtin DESC,
       CASE WHEN b.is_builtin THEN b.id END ASC NULLS LAST,
       b.created_at DESC, b.id DESC`,
    [workspaceId],
  );
  return r.rows as ProjectTemplateSummary[];
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
     WHERE workspace_id = $1 AND archived_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY archived_at DESC`,
    [workspaceId],
  );
  return r.rows as { id: number; name: string; archived_at: string }[];
}

export async function getDeletedProjects(workspaceId: number) {
  const r = await db.query(
    `SELECT p.id, p.name, p.deleted_at::text AS deleted_at,
       COALESCE(u.name, '') AS deleted_by_name,
       (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS task_count
     FROM projects p LEFT JOIN users u ON u.id = p.deleted_by
     WHERE p.workspace_id = $1 AND p.deleted_at IS NOT NULL
     ORDER BY p.deleted_at DESC`,
    [workspaceId],
  );
  return r.rows as {
    id: number;
    name: string;
    deleted_at: string;
    deleted_by_name: string;
    task_count: number;
  }[];
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

