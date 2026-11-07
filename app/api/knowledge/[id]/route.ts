import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withResourceProject("edit", "project_knowledge", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
  const payload = (body ?? {}) as { title?: unknown; body?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.title === "string" && payload.title.trim() !== "") {
    values.push(payload.title.trim());
    sets.push(`title = $${values.length}`);
  }
  if (typeof payload.body === "string" && payload.body.trim() !== "") {
    values.push(payload.body.trim());
    sets.push(`body = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  await db.query(
    `UPDATE project_knowledge SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(uid, "knowledge.update", {
    entity: "knowledge",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id) });
}, { body: true });

export const DELETE = withResourceProject("edit", "project_knowledge", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  await db.query("DELETE FROM project_knowledge WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(uid, "knowledge.delete", {
    entity: "knowledge",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
});
