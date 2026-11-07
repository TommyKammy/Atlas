import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { getDashboardWidgets } from "@/lib/dashboard";
import { parseWidgetPayload } from "@/lib/dashboard-validation";

export const PATCH = withProject(
  "edit",
  async (_req, { uid, projectId, params, body }) => {
    const id = Number(params.widgetId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid widget id" }, { status: 400 });
    }
    const parsed = parseWidgetPayload(body, { partial: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const widget = parsed.value;
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    };
    if (widget.title !== undefined) add("title", widget.title);
    if (widget.widget_type !== undefined) add("widget_type", widget.widget_type);
    if (widget.chart_type !== undefined) add("chart_type", widget.chart_type);
    if (widget.group_by !== undefined) add("group_by", widget.group_by);
    if (widget.metric !== undefined) add("metric", widget.metric);
    if (widget.filters !== undefined) add("filters", JSON.stringify(widget.filters), "::jsonb");
    if (widget.options !== undefined) add("options", JSON.stringify(widget.options), "::jsonb");
    if (widget.body !== undefined) add("body", widget.body);
    if (sets.length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    values.push(id, projectId);
    const r = await db.query(
      `UPDATE project_dashboard_widgets
       SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length - 1} AND project_id = $${values.length}
       RETURNING id, title`,
      values,
    );
    if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    await audit(uid, "dashboard.widget.update", {
      entity: "project_dashboard_widget",
      entityId: id,
      projectId,
      summary: r.rows[0].title,
    });
    return NextResponse.json({ widgets: await getDashboardWidgets(projectId) });
  },
  { body: true },
);

export const DELETE = withProject("edit", async (_req, { uid, projectId, params }) => {
  const id = Number(params.widgetId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid widget id" }, { status: 400 });
  }
  const r = await db.query(
    "DELETE FROM project_dashboard_widgets WHERE id = $1 AND project_id = $2 RETURNING id, title",
    [id, projectId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "dashboard.widget.delete", {
    entity: "project_dashboard_widget",
    entityId: id,
    projectId,
    summary: r.rows[0].title,
  });
  return NextResponse.json({ widgets: await getDashboardWidgets(projectId) });
});
