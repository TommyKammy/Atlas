import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { normalizeWidgets } from "@/lib/dashboard-widgets";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query("SELECT widgets FROM dashboard_prefs WHERE user_id = $1 AND project_id = $2::bigint", [
    uid,
    projectId,
  ]);
  if (r.rowCount === 0) return NextResponse.json({ widgets: null });
  return NextResponse.json({ widgets: normalizeWidgets(r.rows[0].widgets) });
}

export async function PUT(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const { project_id, widgets } = body ?? {};
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const me = await db.query("SELECT id FROM users WHERE id = $1", [uid]);
  if (me.rowCount === 0) return NextResponse.json({ error: "unknown user" }, { status: 403 });
  const p = await db.query("SELECT id FROM projects WHERE id = $1::bigint", [project_id]);
  if (p.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const normalized = normalizeWidgets(widgets);
  await db.query(
    `INSERT INTO dashboard_prefs (user_id, project_id, widgets)
     VALUES ($1, $2::bigint, $3::jsonb)
     ON CONFLICT (user_id, project_id) DO UPDATE SET widgets = EXCLUDED.widgets`,
    [uid, project_id, JSON.stringify(normalized)],
  );
  return NextResponse.json({ widgets: normalized });
}
