import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { getProjectForms } from "@/lib/data";
import { normalizeFormFields } from "@/lib/forms";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getProjectForms(projectId));
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { name, description, fields } = (body ?? {}) as { name?: string; description?: string; fields?: unknown };
  const normalized = normalizeFormFields(fields);
  if (!name || String(name).trim() === "" || !normalized) {
    return NextResponse.json({ error: "name and valid fields are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO project_forms (project_id, name, description, fields, created_by)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5) RETURNING id`,
    [
      projectId,
      String(name).trim(),
      String(description ?? "").trim(),
      JSON.stringify(normalized),
      uid,
    ],
  );
  await notifyProject(projectId);
  await audit(uid, "form.create", {
    entity: "form",
    entityId: r.rows[0].id,
    projectId,
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
