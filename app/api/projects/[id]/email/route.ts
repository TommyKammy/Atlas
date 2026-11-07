import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";

function newAddress(projectId: number) {
  return `project-${projectId}-${randomUUID().slice(0, 8)}@inbox.atlas.local`;
}

export const GET = withProject("view", async (_req, { projectId }) => {
  const project = await db.query(
    "SELECT email_address, email_enabled FROM projects WHERE id = $1::bigint",
    [projectId],
  );
  let address = project.rows[0].email_address as string | null;
  if (!address) {
    address = newAddress(projectId);
    await db.query("UPDATE projects SET email_address = $1 WHERE id = $2::bigint", [address, projectId]);
  }
  const messages = await db.query(
    `SELECT id, from_address, subject, task_id, received_at::text AS received_at
     FROM project_email_messages WHERE project_id = $1
     ORDER BY id DESC LIMIT 10`,
    [projectId],
  );
  return NextResponse.json({
    address,
    enabled: project.rows[0].email_enabled !== false,
    recent: messages.rows,
  });
});

export const PATCH = withProject("edit", async (_req, { projectId, body }) => {
  const payload = (body ?? {}) as { enabled?: unknown; regenerate?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.enabled === "boolean") {
    values.push(payload.enabled);
    sets.push(`email_enabled = $${values.length}`);
  }
  if (payload.regenerate === true) {
    values.push(newAddress(projectId));
    sets.push(`email_address = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(projectId);
  await db.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $${values.length}::bigint`, values);
  const updated = await db.query(
    "SELECT email_address, email_enabled FROM projects WHERE id = $1::bigint",
    [projectId],
  );
  return NextResponse.json({
    address: updated.rows[0].email_address,
    enabled: updated.rows[0].email_enabled !== false,
  });
}, { body: true });
