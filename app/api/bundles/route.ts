import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { withAdmin } from "@/lib/api/route";
import { getBundlesForProject } from "@/lib/data";
import { normalizeBundleFields } from "@/lib/bundles";
import { audit } from "@/lib/audit";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getBundlesForProject(projectId));
});

export const POST = withAdmin(async (req, { uid }) => {
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
});
