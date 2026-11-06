import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { getBundlesForProject } from "@/lib/data";
import { normalizeBundleFields } from "@/lib/bundles";
import { audit } from "@/lib/audit";

async function requireAdmin(req: Request): Promise<number | null> {
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query("SELECT is_admin FROM users WHERE id = $1 AND deactivated_at IS NULL", [uid]);
  return (r.rowCount ?? 0) > 0 && r.rows[0].is_admin === true ? uid : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await getBundlesForProject(Number(projectId)));
}

export async function POST(req: Request) {
  const uid = await requireAdmin(req);
  if (uid === null) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const workspaceId = Number(body?.workspace_id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const fields = normalizeBundleFields(body?.fields);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0 || name === "" || !fields) {
    return NextResponse.json({ error: "workspace_id, name and valid fields are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO bundles (workspace_id, name, description, fields, created_by)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5) RETURNING id`,
    [workspaceId, name, String(body?.description ?? "").trim(), JSON.stringify(fields), uid],
  );
  await audit(uid, "bundle.create", {
    entity: "bundle",
    entityId: r.rows[0].id,
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
