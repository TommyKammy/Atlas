import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { canEditProject } from "@/lib/project-roles";

type EndpointRow = {
  id: number;
  project_id: number;
  name: string;
  token: string;
  has_secret: boolean;
  enabled: boolean;
  created_at: string;
};

export const GET = withProject("view", async (_req, { projectId, role }) => {
  const includeToken = canEditProject(role);
  const r = await db.query(
    `SELECT id, project_id, name, CASE WHEN $2::boolean THEN token END AS token, enabled,
       (btrim(secret) <> '') AS has_secret, created_at::text AS created_at
     FROM automation_webhook_endpoints
     WHERE project_id = $1::bigint
     ORDER BY id`,
    [projectId, includeToken],
  );
  const endpoints = (r.rows as EndpointRow[]).map(({ token, ...endpoint }) =>
    includeToken ? { ...endpoint, token } : endpoint,
  );
  return NextResponse.json({ endpoints });
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { name?: unknown; secret?: unknown };
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
  const secret = typeof payload.secret === "string" ? payload.secret.trim() : "";
  if (secret.length === 0 || secret.length > 200) {
    return NextResponse.json({ error: "secret must be between 1 and 200 characters" }, { status: 400 });
  }
  const project = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
    projectId,
  ]);
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = randomBytes(24).toString("hex");
  const r = await db.query(
    `INSERT INTO automation_webhook_endpoints (
       workspace_id, project_id, name, token, secret, created_by
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::bigint)
     RETURNING id, project_id, name, token, enabled,
       (secret <> '') AS has_secret, created_at::text AS created_at`,
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
