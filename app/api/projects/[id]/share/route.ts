import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProjectPermission(req, Number(id), "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    "SELECT id, label, created_at::text AS created_at, expires_at::text AS expires_at FROM project_share_tokens WHERE project_id = $1::bigint ORDER BY id",
    [id],
  );
  return NextResponse.json(r.rows);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProjectPermission(req, Number(id), "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) : "";
  const expRaw = body?.expires_in_days;
  const expDays = expRaw === 7 || expRaw === 30 ? expRaw : null;
  const p = await db.query("SELECT id FROM projects WHERE id = $1::bigint", [id]);
  if (p.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = randomBytes(24).toString("base64url");
  const r = await db.query(
    "INSERT INTO project_share_tokens (project_id, token, label, expires_at, created_by) VALUES ($1::bigint, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $4::int) END, $5) RETURNING id, token",
    [id, token, label, expDays, uid],
  );
  await notifyProject(id);
  return NextResponse.json(r.rows[0], { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireProjectPermission(req, Number(id), "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { searchParams } = new URL(req.url);
  const tokenRowId = searchParams.get("token_id");
  if (!tokenRowId) return NextResponse.json({ error: "token_id is required" }, { status: 400 });
  const r = await db.query(
    "DELETE FROM project_share_tokens WHERE id = $1::bigint AND project_id = $2::bigint",
    [tokenRowId, id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(id);
  return NextResponse.json({ deleted: Number(tokenRowId) });
}
