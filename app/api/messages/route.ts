import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT m.id, m.title, m.body, m.created_at::text AS created_at, u.name AS author_name
     FROM project_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.project_id = $1::bigint ORDER BY m.id DESC LIMIT 100`,
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { title, body: text } = (body ?? {}) as { title?: string; body?: string };
  if (!text || String(text).trim() === "") {
    return NextResponse.json({ error: "project_id and body are required" }, { status: 400 });
  }
  const r = await db.query(
    "INSERT INTO project_messages (project_id, author_id, title, body) VALUES ($1::bigint, $2, $3, $4) RETURNING id",
    [projectId, uid, String(title ?? "").trim(), String(text).trim()],
  );
  await notifyProject(projectId);
  await audit(uid, "message.create", { entity: "message", entityId: r.rows[0].id, projectId });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
