import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";

type EndpointRow = {
  id: number;
  project_id: number;
  name: string;
  token: string;
  secret: string;
  enabled: boolean;
  created_at: string;
};

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT id, project_id, name, token, secret, enabled, created_at::text AS created_at
     FROM automation_webhook_endpoints
     WHERE project_id = $1::bigint
     ORDER BY id`,
    [projectId],
  );
  return NextResponse.json({ endpoints: r.rows as EndpointRow[] });
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { name?: unknown; secret?: unknown };
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
  const project = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
    projectId,
  ]);
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = randomBytes(24).toString("hex");
  const secret = typeof payload.secret === "string" ? payload.secret.trim().slice(0, 200) : "";
  const r = await db.query(
    `INSERT INTO automation_webhook_endpoints (
       workspace_id, project_id, name, token, secret, created_by
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::bigint)
     RETURNING id, project_id, name, token, secret, enabled, created_at::text AS created_at`,
    [Number(project.rows[0].workspace_id), projectId, name.slice(0, 120), token, secret, uid],
  );
  await audit(uid, "automation.webhook.create", {
    entity: "automation_webhook",
    entityId: r.rows[0].id,
    projectId,
    summary: name,
  });
  return NextResponse.json({ endpoint: r.rows[0] as EndpointRow }, { status: 201 });
}, { body: true });
