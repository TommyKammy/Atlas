import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withProject("edit", async (_req, { uid, projectId, params, body }) => {
  const appId = params.appId;
  const owned = await db.query(
    "SELECT id FROM project_apps WHERE id = $1::bigint AND project_id = $2::bigint",
    [appId, projectId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = (body ?? {}) as { enabled?: unknown; config?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.enabled === "boolean") {
    values.push(payload.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (typeof payload.config === "object" && payload.config !== null) {
    values.push(JSON.stringify(payload.config));
    sets.push(`config = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(appId);
  await db.query(
    `UPDATE project_apps SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(uid, "project_app.update", {
    entity: "project_app",
    entityId: Number(appId),
    projectId,
  });
  return NextResponse.json({ id: Number(appId) });
}, { body: true });

export const DELETE = withProject("edit", async (_req, { uid, projectId, params }) => {
  const appId = params.appId;
  const owned = await db.query(
    "SELECT id FROM project_apps WHERE id = $1::bigint AND project_id = $2::bigint",
    [appId, projectId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.query("DELETE FROM project_apps WHERE id = $1::bigint", [appId]);
  await notifyProject(projectId);
  await audit(uid, "project_app.remove", {
    entity: "project_app",
    entityId: Number(appId),
    projectId,
  });
  return NextResponse.json({ deleted: Number(appId) });
});
