import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT k.id, k.title, k.body, k.created_at::text AS created_at,
            k.updated_at::text AS updated_at, u.name AS author_name
     FROM project_knowledge k LEFT JOIN users u ON u.id = k.author_id
     WHERE k.project_id = $1::bigint ORDER BY k.updated_at DESC, k.id DESC LIMIT 100`,
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { title, body: text } = (body ?? {}) as { title?: string; body?: string };
  if (!title || String(title).trim() === "" || !text || String(text).trim() === "") {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO project_knowledge (project_id, author_id, title, body)
     VALUES ($1::bigint, $2, $3, $4) RETURNING id`,
    [projectId, uid, String(title).trim(), String(text).trim()],
  );
  await notifyProject(projectId);
  await audit(uid, "knowledge.create", {
    entity: "knowledge",
    entityId: r.rows[0].id,
    projectId,
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
