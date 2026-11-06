import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";
const MAX_BYTES = 25 * 1024 * 1024;

function safeExt(name: string): string {
  const ext = path.extname(name).slice(0, 10).toLowerCase();
  return /^[.a-z0-9]+$/.test(ext) ? ext : "";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("task_id");
  const projectId = searchParams.get("project_id");
  if (taskId) {
    const projectIdForTask = await getTaskProjectId(Number(taskId));
    if (projectIdForTask !== null) {
      const auth = await requireProjectPermission(req, projectIdForTask, "view");
      if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const r = await db.query(
      `SELECT a.id, a.task_id, a.file_name, a.mime_type, a.size_bytes::int AS size_bytes,
         u.name AS author_name, a.created_at::text AS created_at
       FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.task_id = $1::bigint ORDER BY a.id`,
      [taskId],
    );
    return NextResponse.json(r.rows);
  }
  if (projectId) {
    const auth = await requireProjectPermission(req, Number(projectId), "view");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const r = await db.query(
      `SELECT a.id, a.task_id, t.name AS task_name, a.file_name, a.mime_type,
         a.size_bytes::int AS size_bytes, u.name AS author_name, a.created_at::text AS created_at
       FROM task_attachments a JOIN tasks t ON t.id = a.task_id
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE t.project_id = $1::bigint OR EXISTS
         (SELECT 1 FROM task_project_memberships m WHERE m.task_id = t.id AND m.project_id = $1::bigint)
       ORDER BY a.id DESC LIMIT 200`,
      [projectId],
    );
    return NextResponse.json(r.rows);
  }
  return NextResponse.json({ error: "task_id or project_id is required" }, { status: 400 });
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const form = await req.formData();
  const taskId = form.get("task_id");
  const file = form.get("file");
  if (typeof taskId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "task_id and file are required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 25MB" }, { status: 413 });
  }
  const t = await db.query("SELECT id FROM tasks WHERE id = $1::bigint", [taskId]);
  if (t.rowCount === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const projectId = await getTaskProjectId(Number(taskId));
  if (projectId !== null) {
    const auth = await requireProjectPermission(req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const original = file.name.slice(0, 255) || "unnamed";
  const stored = `${randomUUID()}${safeExt(original)}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, stored), bytes);

  const r = await db.query(
    `INSERT INTO task_attachments (task_id, file_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1::bigint, $2, $3, $4, $5, $6) RETURNING id`,
    [taskId, original, stored, file.type || "application/octet-stream", file.size, uid],
  );
  await notifyTask(taskId);
  await audit(getCurrentUserIdFromRequest(req), "attachment.create", { entity: "attachment", entityId: r.rows[0].id, summary: original });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
