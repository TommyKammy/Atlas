import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";

export const GET = withProject("share", async (_req, { projectId }) => {
  const r = await db.query(
    "SELECT id, label, created_at::text AS created_at, expires_at::text AS expires_at FROM project_share_tokens WHERE project_id = $1::bigint ORDER BY id",
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("share", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { label?: unknown; expires_in_days?: unknown };
  const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 120) : "";
  const expRaw = payload.expires_in_days;
  const expDays = expRaw === 7 || expRaw === 30 ? expRaw : null;
  const token = randomBytes(24).toString("base64url");
  const r = await db.query(
    "INSERT INTO project_share_tokens (project_id, token, label, expires_at, created_by) VALUES ($1::bigint, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $4::int) END, $5) RETURNING id, token",
    [projectId, token, label, expDays, uid],
  );
  await notifyProject(projectId);
  return NextResponse.json(r.rows[0], { status: 201 });
}, { body: true });

export const DELETE = withProject("share", async (req, { projectId }) => {
  const { searchParams } = new URL(req.url);
  const tokenRowId = searchParams.get("token_id");
  if (!tokenRowId) return NextResponse.json({ error: "token_id is required" }, { status: 400 });
  const r = await db.query(
    "DELETE FROM project_share_tokens WHERE id = $1::bigint AND project_id = $2::bigint",
    [tokenRowId, projectId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(projectId);
  return NextResponse.json({ deleted: Number(tokenRowId) });
});
