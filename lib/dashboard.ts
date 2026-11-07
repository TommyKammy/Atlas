import { db } from "./db";
import { normaliseWidgetFilters, normaliseWidgetOptions } from "./dashboard-compute";
import {
  defaultDashboardWidgets,
  type DashboardTask,
  type DashboardWidget,
} from "./dashboard-types";
import { projectTaskScope } from "./repositories/scope";

type WidgetRow = {
  id: number;
  project_id: number;
  title: string;
  widget_type: "chart" | "text";
  chart_type: DashboardWidget["chart_type"];
  group_by: DashboardWidget["group_by"];
  metric: DashboardWidget["metric"];
  filters: unknown;
  options: unknown;
  body: string;
  position: number;
  created_at: string;
  updated_at: string;
};

function toWidget(row: WidgetRow): DashboardWidget {
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    title: row.title,
    widget_type: row.widget_type,
    chart_type: row.chart_type,
    group_by: row.group_by,
    metric: row.metric,
    filters: normaliseWidgetFilters(row.filters),
    options: normaliseWidgetOptions(row.options),
    body: row.body ?? "",
    position: Number(row.position),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureDefaultWidgets(projectId: number): Promise<void> {
  const project = await db.query(
    "SELECT dashboard_initialized FROM projects WHERE id = $1",
    [projectId],
  );
  if (project.rows[0]?.dashboard_initialized === true) return;
  const defaults = defaultDashboardWidgets();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [projectId]);
    const again = await client.query(
      "SELECT dashboard_initialized FROM projects WHERE id = $1 FOR UPDATE",
      [projectId],
    );
    if (again.rows[0]?.dashboard_initialized !== true) {
      for (const [index, widget] of defaults.entries()) {
        await client.query(
          `INSERT INTO project_dashboard_widgets
             (project_id, title, widget_type, chart_type, group_by, metric, filters, options, body, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            projectId,
            widget.title,
            widget.widget_type,
            widget.chart_type,
            widget.group_by,
            widget.metric,
            JSON.stringify(widget.filters ?? {}),
            JSON.stringify(widget.options ?? {}),
            "",
            (index + 1) * 1000,
          ],
        );
      }
      await client.query("UPDATE projects SET dashboard_initialized = TRUE WHERE id = $1", [projectId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getDashboardWidgets(projectId: number): Promise<DashboardWidget[]> {
  await ensureDefaultWidgets(projectId);
  const r = await db.query(
    `SELECT id, project_id, title, widget_type, chart_type, group_by, metric,
       filters, options, body, position, created_at::text AS created_at,
       updated_at::text AS updated_at
     FROM project_dashboard_widgets
     WHERE project_id = $1
     ORDER BY position, id`,
    [projectId],
  );
  return (r.rows as WidgetRow[]).map(toWidget);
}

export async function getDashboardTasks(projectId: number): Promise<DashboardTask[]> {
  const r = await db.query(
    `SELECT t.id, t.name,
       COALESCE(m.section_id, t.section_id) AS section_id,
       t.assignee_id, u.name AS assignee_name, t.status, t.completed,
       t.due_on::text AS due_on,
       t.created_at::date::text AS created_on,
       t.completed_at::date::text AS completed_on,
       t.progress
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1
     WHERE t.parent_task_id IS NULL AND t.deleted_at IS NULL
       AND ${projectTaskScope("t")}
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return (r.rows as DashboardTask[]).map((row) => ({
    ...row,
    id: Number(row.id),
    section_id: row.section_id === null ? null : Number(row.section_id),
    assignee_id: row.assignee_id === null ? null : Number(row.assignee_id),
    progress: Number(row.progress) || 0,
    completed: row.completed === true,
  }));
}

export async function getDashboardPageData(projectId: number) {
  const [widgets, tasks] = await Promise.all([
    getDashboardWidgets(projectId),
    getDashboardTasks(projectId),
  ]);
  return { widgets, tasks };
}

/** Persist the requested widget order. Returns the fresh widget list. */
export async function reorderDashboardWidgets(projectId: number, order: number[]): Promise<DashboardWidget[]> {
  const ids = [...new Set(order.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return getDashboardWidgets(projectId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      "SELECT id FROM project_dashboard_widgets WHERE project_id = $1",
      [projectId],
    );
    const ownedIds = new Set(owned.rows.map((row) => Number(row.id)));
    let position = 1000;
    for (const id of ids) {
      if (!ownedIds.has(id)) continue;
      await client.query(
        "UPDATE project_dashboard_widgets SET position = $1, updated_at = now() WHERE id = $2 AND project_id = $3",
        [position, id, projectId],
      );
      position += 1000;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return getDashboardWidgets(projectId);
}
