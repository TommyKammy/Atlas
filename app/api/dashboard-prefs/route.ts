import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeWidgets } from "@/lib/dashboard-widgets";
import { withProject } from "@/lib/api/route";

export const GET = withProject("view", async (_req, { uid, projectId }) => {
  const r = await db.query("SELECT widgets FROM dashboard_prefs WHERE user_id = $1 AND project_id = $2::bigint", [
    uid,
    projectId,
  ]);
  if (r.rowCount === 0) return NextResponse.json({ widgets: null });
  return NextResponse.json({ widgets: normalizeWidgets(r.rows[0].widgets) });
});

export const PUT = withProject("view", async (_req, { uid, projectId, body }) => {
  const { widgets } = (body ?? {}) as { widgets?: unknown };
  const normalized = normalizeWidgets(widgets);
  await db.query(
    `INSERT INTO dashboard_prefs (user_id, project_id, widgets)
     VALUES ($1, $2::bigint, $3::jsonb)
     ON CONFLICT (user_id, project_id) DO UPDATE SET widgets = EXCLUDED.widgets`,
    [uid, projectId, JSON.stringify(normalized)],
  );
  return NextResponse.json({ widgets: normalized });
}, { body: true });
