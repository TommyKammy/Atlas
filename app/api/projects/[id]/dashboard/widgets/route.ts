import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { getDashboardWidgets, reorderDashboardWidgets } from "@/lib/dashboard";
import { parseWidgetPayload } from "@/lib/dashboard-validation";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json({ widgets: await getDashboardWidgets(projectId) });
});

export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const parsed = parseWidgetPayload(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const widget = parsed.value;
    const position = await db.query(
      "SELECT COALESCE(MAX(position), 0) + 1000 AS position FROM project_dashboard_widgets WHERE project_id = $1",
      [projectId],
    );
    const r = await db.query(
      `INSERT INTO project_dashboard_widgets
         (project_id, title, widget_type, chart_type, group_by, metric, filters, options, body, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       RETURNING id`,
      [
        projectId,
        widget.title,
        widget.widget_type,
        widget.chart_type,
        widget.group_by,
        widget.metric,
        JSON.stringify(widget.filters),
        JSON.stringify(widget.options),
        widget.body,
        Number(position.rows[0].position),
        uid,
      ],
    );
    await audit(uid, "dashboard.widget.create", {
      entity: "project_dashboard_widget",
      entityId: r.rows[0].id,
      projectId,
      summary: widget.title,
    });
    return NextResponse.json(
      { widgets: await getDashboardWidgets(projectId) },
      { status: 201 },
    );
  },
  { body: true },
);

export const PATCH = withProject(
  "edit",
  async (_req, { projectId, body }) => {
    const raw = body as { order?: unknown } | null;
    if (!raw || !Array.isArray(raw.order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }
    const order = raw.order.map(Number);
    return NextResponse.json({ widgets: await reorderDashboardWidgets(projectId, order) });
  },
  { body: true },
);
