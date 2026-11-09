import { db, withTransaction } from "../db";
import {
  DEFAULT_HOME_WIDGETS,
  type HomeMember,
  type HomeProject,
  type HomeTask,
  type HomeWidget,
  type HomeWidgetSize,
  type HomeWidgetType,
} from "../home-widgets";
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
