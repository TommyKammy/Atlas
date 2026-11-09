import { db, withTransaction } from "../db";
import {
  DEFAULT_HOME_WIDGETS,
  type HomeCommentDraft,
  type HomeForm,
  type HomeMember,
  type HomeMention,
  type HomeNotepad,
  type HomePortfolioProject,
  type HomeProject,
  type HomeStatusProject,
  type HomeStatusUpdate,
  type HomeTask,
  type HomeWidget,
  type HomeWidgetSize,
  type HomeWidgetType,
} from "../home-widgets";
import type { RichTextDoc } from "../rich-text-types";
import { TASK_FROM, TASK_SELECT_COLS, toTaskRow } from "./task-select";

function toHomeWidget(row: Record<string, unknown>): HomeWidget {
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    user_id: Number(row.user_id),
    widget_type: row.widget_type as HomeWidgetType,
    size: row.size as HomeWidgetSize,
    position: Number(row.position),
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

/** First visit seeds the Asana-like default home; deleting all widgets is respected. */
async function ensureDefaultHomeWidgets(workspaceId: number, userId: number) {
  const user = await db.query("SELECT home_widgets_initialized FROM users WHERE id = $1", [userId]);
  if (user.rows[0]?.home_widgets_initialized === true) return;

  await withTransaction(async (q) => {
    let position = 1000;
    for (const widget of DEFAULT_HOME_WIDGETS) {
      await q.query(
        `INSERT INTO home_widgets (workspace_id, user_id, widget_type, size, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, user_id, widget_type) DO NOTHING`,
        [workspaceId, userId, widget.widget_type, widget.size, position],
      );
      position += 1000;
    }
    await q.query("UPDATE users SET home_widgets_initialized = TRUE WHERE id = $1", [userId]);
  });
}

export async function getHomeWidgets(workspaceId: number, userId: number): Promise<HomeWidget[]> {
  await ensureDefaultHomeWidgets(workspaceId, userId);
  const r = await db.query(
    `SELECT id, workspace_id, user_id, widget_type, size, position, config
     FROM home_widgets
     WHERE workspace_id = $1 AND user_id = $2
     ORDER BY position, id`,
    [workspaceId, userId],
  );
  return r.rows.map(toHomeWidget);
}

export async function addHomeWidget(
  workspaceId: number,
  userId: number,
  widgetType: HomeWidgetType,
  size: HomeWidgetSize,
): Promise<HomeWidget[]> {
  const position = await db.query(
    "SELECT COALESCE(MAX(position), 0) + 1000 AS position FROM home_widgets WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId],
  );
  await db.query(
    `INSERT INTO home_widgets (workspace_id, user_id, widget_type, size, position)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, user_id, widget_type) DO UPDATE SET updated_at = now()`,
    [workspaceId, userId, widgetType, size, Number(position.rows[0].position)],
  );
  await db.query("UPDATE users SET home_widgets_initialized = TRUE WHERE id = $1", [userId]);
  return getHomeWidgets(workspaceId, userId);
}

export async function updateHomeWidget(
  workspaceId: number,
  userId: number,
  widgetId: number,
  patch: { size?: HomeWidgetSize; config?: Record<string, unknown> },
): Promise<HomeWidget[]> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.size) {
    values.push(patch.size);
    sets.push(`size = $${values.length}`);
  }
  if (patch.config) {
    values.push(JSON.stringify(patch.config));
    sets.push(`config = $${values.length}::jsonb`);
  }
  if (sets.length > 0) {
    values.push(widgetId, workspaceId, userId);
    await db.query(
      `UPDATE home_widgets SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length - 2} AND workspace_id = $${values.length - 1} AND user_id = $${values.length}`,
      values,
    );
  }
  return getHomeWidgets(workspaceId, userId);
}

export async function deleteHomeWidget(
  workspaceId: number,
  userId: number,
  widgetId: number,
): Promise<HomeWidget[]> {
  await db.query(
    "DELETE FROM home_widgets WHERE id = $1 AND workspace_id = $2 AND user_id = $3",
    [widgetId, workspaceId, userId],
  );
  await db.query("UPDATE users SET home_widgets_initialized = TRUE WHERE id = $1", [userId]);
  return getHomeWidgets(workspaceId, userId);
}

export async function reorderHomeWidgets(
  workspaceId: number,
  userId: number,
  order: number[],
): Promise<HomeWidget[]> {
  const ids = [...new Set(order.filter((id) => Number.isInteger(id) && id > 0))];
  await withTransaction(async (q) => {
    const owned = await q.query(
      "SELECT id FROM home_widgets WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    const ownedIds = new Set(owned.rows.map((row) => Number(row.id)));
    let position = 1000;
    for (const id of ids) {
      if (!ownedIds.has(id)) continue;
      await q.query(
        "UPDATE home_widgets SET position = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND user_id = $4",
        [position, id, workspaceId, userId],
      );
      position += 1000;
    }
  });
  return getHomeWidgets(workspaceId, userId);
}

export async function getHomeMyTasks(userId: number): Promise<HomeTask[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS} ${TASK_FROM}
     WHERE t.assignee_id = $1 AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
     ORDER BY t.completed, t.due_on NULLS LAST, t.position, t.id
     LIMIT 300`,
    [userId],
  );
  return r.rows.map((row) => ({ ...toTaskRow(row as never), project_name: row.project_name ?? null }));
}

export async function getHomeAssignedTasks(userId: number): Promise<HomeTask[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS} ${TASK_FROM}
     WHERE t.created_by = $1 AND t.assignee_id IS NOT NULL AND t.assignee_id <> $1
       AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
     ORDER BY t.completed, t.due_on NULLS LAST, t.id DESC
     LIMIT 300`,
    [userId],
  );
  return r.rows.map((row) => ({ ...toTaskRow(row as never), project_name: row.project_name ?? null }));
}

export async function getHomeProjects(workspaceId: number, userId: number): Promise<HomeProject[]> {
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon,
       COUNT(t.id) FILTER (
         WHERE t.parent_task_id IS NULL AND NOT t.completed
           AND t.due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
       )::int AS due_soon,
       COUNT(t.id) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed)::int AS open_count,
       r.opened_at::text AS last_opened
     FROM projects p
     LEFT JOIN user_recent_projects r ON r.project_id = p.id AND r.user_id = $2
     LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)
       )
     GROUP BY p.id, p.name, p.color, p.icon, r.opened_at
     ORDER BY r.opened_at DESC NULLS LAST, p.id DESC
     LIMIT 24`,
    [workspaceId, userId],
  );
  return r.rows as HomeProject[];
}

export async function getHomeMembers(workspaceId: number, viewerId: number): Promise<HomeMember[]> {
  const r = await db.query(
    `WITH visible_projects AS (
       SELECT p.id
       FROM projects p
       WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
         AND (
           EXISTS (SELECT 1 FROM users v WHERE v.id = $2 AND v.is_admin)
           OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)
         )
     )
     SELECT u.id, u.name, u.title, u.avatar_url,
       (SELECT COUNT(DISTINCT pm.project_id) FROM project_members pm
        WHERE pm.user_id = u.id AND pm.project_id IN (SELECT id FROM visible_projects))::int AS shared_projects,
       (SELECT COUNT(*) FROM tasks t
        WHERE t.assignee_id = u.id AND NOT t.completed AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND (t.project_id IN (SELECT id FROM visible_projects)
            OR EXISTS (SELECT 1 FROM task_project_memberships tm
                       WHERE tm.task_id = t.id AND tm.project_id IN (SELECT id FROM visible_projects))))::int AS open_tasks,
       (SELECT COUNT(*) FROM tasks t
        WHERE t.assignee_id = u.id AND NOT t.completed AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS week_tasks,
       (SELECT COUNT(*) FROM tasks t
        WHERE t.assignee_id = u.id AND NOT t.completed AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS month_tasks
     FROM users u
     WHERE u.deactivated_at IS NULL AND u.id <> $2
     ORDER BY open_tasks DESC, shared_projects DESC, u.id
     LIMIT 12`,
    [workspaceId, viewerId],
  );
  return r.rows as HomeMember[];
}

const VISIBLE_PROJECT_SQL = `
  p.archived_at IS NULL AND p.deleted_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM users v WHERE v.id = $2 AND v.is_admin)
    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)
  )`;

/** Portfolio projects with aggregate task metrics, saved portfolio first. */
export async function getHomePortfolio(
  workspaceId: number,
  userId: number,
): Promise<HomePortfolioProject[]> {
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon,
       COUNT(DISTINCT t.id) FILTER (WHERE t.parent_task_id IS NULL)::int AS total,
       COUNT(DISTINCT t.id) FILTER (WHERE t.parent_task_id IS NULL AND t.completed)::int AS done,
       COUNT(DISTINCT t.id) FILTER (
         WHERE t.parent_task_id IS NULL AND NOT t.completed AND t.due_on < CURRENT_DATE
       )::int AS overdue,
       COUNT(DISTINCT pm.user_id)::int AS members,
       MIN(t.due_on) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed)::text AS min_due,
       MAX(t.due_on) FILTER (WHERE t.parent_task_id IS NULL AND NOT t.completed)::text AS max_due,
       EXISTS (
         SELECT 1 FROM portfolio_projects pp WHERE pp.user_id = $2 AND pp.project_id = p.id
       ) AS saved
     FROM projects p
     LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
     LEFT JOIN project_members pm ON pm.project_id = p.id
     WHERE p.workspace_id = $1 AND ${VISIBLE_PROJECT_SQL}
     GROUP BY p.id
     ORDER BY saved DESC, p.id`,
    [workspaceId, userId],
  );
  return r.rows as HomePortfolioProject[];
}

/** Latest project status updates across every project the viewer can see. */
export async function getHomeStatusUpdates(
  workspaceId: number,
  userId: number,
): Promise<HomeStatusUpdate[]> {
  const r = await db.query(
    `SELECT s.id, s.project_id, p.name AS project_name, p.color AS project_color,
       p.icon AS project_icon, s.author_id, u.name AS author_name,
       u.avatar_url AS author_avatar_url, LEFT(s.body, 800) AS body,
       s.status, s.status_color, s.created_at::text AS created_at
     FROM project_status_updates s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.author_id
     WHERE p.workspace_id = $1 AND ${VISIBLE_PROJECT_SQL}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 20`,
    [workspaceId, userId],
  );
  return r.rows as HomeStatusUpdate[];
}

/** Projects the viewer can post a status update to (editor/admin). */
export async function getHomeStatusProjects(
  workspaceId: number,
  userId: number,
): Promise<HomeStatusProject[]> {
  const r = await db.query(
    `SELECT p.id, p.name, p.color, p.icon, p.status, p.status_color
     FROM projects p
     WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (
           SELECT 1 FROM project_members m
           WHERE m.project_id = p.id AND m.user_id = $2
             AND m.role IN ('admin', 'editor', 'member')
         )
       )
     ORDER BY p.name, p.id
     LIMIT 100`,
    [workspaceId, userId],
  );
  return r.rows as HomeStatusProject[];
}

/** Forms across visible projects, published first. */
export async function getHomeForms(workspaceId: number, userId: number): Promise<HomeForm[]> {
  const r = await db.query(
    `SELECT f.id, f.project_id, p.name AS project_name, p.color AS project_color,
       p.icon AS project_icon, f.name, f.description, f.published,
       COUNT(r.id)::int AS response_count, f.updated_at::text AS updated_at
     FROM project_forms f
     JOIN projects p ON p.id = f.project_id
     LEFT JOIN form_responses r ON r.form_id = f.id
     WHERE p.workspace_id = $1 AND ${VISIBLE_PROJECT_SQL}
     GROUP BY f.id, p.id
     ORDER BY f.published DESC, f.updated_at DESC, f.id DESC
     LIMIT 30`,
    [workspaceId, userId],
  );
  return r.rows as HomeForm[];
}

/** Comments that @mention the viewer, newest first. */
export async function getHomeMentions(
  workspaceId: number,
  userId: number,
): Promise<HomeMention[]> {
  const r = await db.query(
    `SELECT c.id AS comment_id, LEFT(c.body, 280) AS body, c.created_at::text AS created_at,
       c.author_id, u.name AS author_name, u.avatar_url AS author_avatar_url,
       t.id AS task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name,
       (ir.comment_id IS NOT NULL) AS is_read
     FROM comment_mentions cm
     JOIN comments c ON c.id = cm.comment_id
     JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN inbox_reads ir ON ir.comment_id = c.id AND ir.user_id = $2
     WHERE cm.user_id = $2 AND p.workspace_id = $1
       AND (c.author_id IS NULL OR c.author_id <> $2)
       AND ${VISIBLE_PROJECT_SQL}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 20`,
    [workspaceId, userId],
  );
  return r.rows as HomeMention[];
}

/** The viewer's unfinished comments, newest first. */
export async function getHomeCommentDrafts(userId: number): Promise<HomeCommentDraft[]> {
  const r = await db.query(
    `SELECT d.task_id, t.name AS task_name, p.id AS project_id, p.name AS project_name,
       LEFT(d.body, 280) AS body, d.updated_at::text AS updated_at
     FROM comment_drafts d
     JOIN tasks t ON t.id = d.task_id AND t.deleted_at IS NULL
     JOIN projects p ON p.id = t.project_id
     WHERE d.user_id = $1
     ORDER BY d.updated_at DESC
     LIMIT 20`,
    [userId],
  );
  return r.rows as HomeCommentDraft[];
}

export async function getCommentDraft(
  userId: number,
  taskId: number,
): Promise<{ body: string; body_doc: RichTextDoc | null; updated_at: string } | null> {
  const r = await db.query(
    `SELECT body, body_doc, updated_at::text AS updated_at
     FROM comment_drafts WHERE user_id = $1 AND task_id = $2`,
    [userId, taskId],
  );
  const row = r.rows[0] as
    | { body: string; body_doc: RichTextDoc | null; updated_at: string }
    | undefined;
  return row ?? null;
}

export async function saveCommentDraft(
  userId: number,
  taskId: number,
  body: string,
  bodyDoc: RichTextDoc | null,
): Promise<void> {
  await db.query(
    `INSERT INTO comment_drafts (user_id, task_id, body, body_doc, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (user_id, task_id)
     DO UPDATE SET body = EXCLUDED.body, body_doc = EXCLUDED.body_doc, updated_at = now()`,
    [userId, taskId, body, bodyDoc ? JSON.stringify(bodyDoc) : null],
  );
}

export async function deleteCommentDraft(userId: number, taskId: number): Promise<void> {
  await db.query("DELETE FROM comment_drafts WHERE user_id = $1 AND task_id = $2", [userId, taskId]);
}

export async function getUserNotepad(userId: number): Promise<HomeNotepad> {
  const r = await db.query(
    "SELECT body, updated_at::text AS updated_at FROM user_notepad WHERE user_id = $1",
    [userId],
  );
  const row = r.rows[0] as { body: string; updated_at: string } | undefined;
  return { body: row?.body ?? "", updated_at: row?.updated_at ?? null };
}

export async function saveUserNotepad(userId: number, body: string): Promise<HomeNotepad> {
  const r = await db.query(
    `INSERT INTO user_notepad (user_id, body, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET body = EXCLUDED.body, updated_at = now()
     RETURNING body, updated_at::text AS updated_at`,
    [userId, body],
  );
  return { body: r.rows[0].body, updated_at: r.rows[0].updated_at };
}

export async function getProjectStatusUpdates(projectId: number): Promise<HomeStatusUpdate[]> {
  const r = await db.query(
    `SELECT s.id, s.project_id, p.name AS project_name, p.color AS project_color,
       p.icon AS project_icon, s.author_id, u.name AS author_name,
       u.avatar_url AS author_avatar_url, s.body, s.status, s.status_color,
       s.created_at::text AS created_at
     FROM project_status_updates s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.author_id
     WHERE s.project_id = $1
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 50`,
    [projectId],
  );
  return r.rows as HomeStatusUpdate[];
}

export async function createProjectStatusUpdate(
  projectId: number,
  authorId: number,
  body: string,
  status: string | null,
  statusColor: string,
): Promise<number> {
  return withTransaction(async (q) => {
    const inserted = await q.query(
      `INSERT INTO project_status_updates (project_id, author_id, body, status, status_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [projectId, authorId, body, status, statusColor],
    );
    if (status !== null) {
      await q.query(
        "UPDATE projects SET status = $2, status_color = $3 WHERE id = $1",
        [projectId, status, statusColor],
      );
    }
    return Number(inserted.rows[0].id);
  });
}
