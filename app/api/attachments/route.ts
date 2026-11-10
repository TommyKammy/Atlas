import { NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { db, withTransaction } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { requireProjectPermission, requireTaskPermission } from "@/lib/api-project-auth";
import { withUser } from "@/lib/api/route";
import { ApiError, badRequest } from "@/lib/api/errors";
import { receiveMultipart } from "@/lib/api/multipart";
import { lockAttachmentFile, pruneUnreferencedAttachment, unlinkIfPresent, UPLOAD_DIR } from "@/lib/attachment-files.mjs";

const MAX_BYTES = 25 * 1024 * 1024;

function safeExt(name: string): string {
  const ext = path.extname(name).slice(0, 10).toLowerCase();
  return /^[.a-z0-9]+$/.test(ext) ? ext : "";
}

export const GET = withUser(async (req) => {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("task_id");
  const projectId = searchParams.get("project_id");
  if (taskId) {
    const auth = await requireTaskPermission(req, Number(taskId), "view");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
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
});

export const POST = withUser(async (req, { uid }) => {
  const authorizeTask = async (taskId: number) => {
    const auth = await requireTaskPermission(req, taskId, "edit");
    if (!auth.ok) throw new ApiError(auth.status, auth.error);
  };
  const fileId = randomUUID();
  const temporary = path.join(UPLOAD_DIR, `.upload-${fileId}.part`);
  let staged = false;
  try {
    const { file } = await receiveMultipart(req, MAX_BYTES, "file exceeds 25MB", async (stream, info, fields) => {
      const taskField = fields.get("task_id");
      if (taskField === undefined) throw badRequest("task_id must precede file");
      const taskId = Number(taskField);
      if (!/^\d+$/.test(taskField.trim()) || !Number.isSafeInteger(taskId) || taskId <= 0) {
        throw badRequest("invalid task_id");
      }
      await authorizeTask(taskId);
      if (req.signal.aborted || stream.destroyed) throw badRequest("upload interrupted");
      await mkdir(UPLOAD_DIR, { recursive: true });
      if (req.signal.aborted || stream.destroyed) throw badRequest("upload interrupted");
      const writer = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
      writer.once("open", () => { staged = true; });
      await pipeline(stream, writer, { signal: req.signal });
      return {
        taskId,
        original: info.filename?.slice(0, 255) || "unnamed",
        mimeType: info.mimeType || "application/octet-stream",
        size: writer.bytesWritten,
      };
    });
    if (!file) {
      return NextResponse.json({ error: "task_id and file are required" }, { status: 400 });
    }

    const { taskId } = file;
    // A long upload can outlast membership or task placement changes.
    await authorizeTask(taskId);
    const stored = `${fileId}${safeExt(file.original)}`;
    let published = false;
    let id: number;
    try {
      id = await withTransaction(async (client) => {
        await lockAttachmentFile(client, stored);
        const result = await client.query<{ id: number }>(
          `INSERT INTO task_attachments (task_id, file_name, stored_name, mime_type, size_bytes, uploaded_by)
           VALUES ($1::bigint, $2, $3, $4, $5, $6) RETURNING id`,
          [taskId, file.original, stored, file.mimeType, file.size, uid],
        );
        await rename(temporary, path.join(UPLOAD_DIR, stored));
        published = true;
        return result.rows[0].id;
      });
    } catch (error) {
      // COMMIT can fail on the client after succeeding on the server. Consult
      // PostgreSQL under the file lock before removing a published file.
      if (published) {
        await withTransaction((client) => pruneUnreferencedAttachment(client, stored))
          .catch((cleanupError) => console.error("attachment rollback cleanup failed", cleanupError));
      }
      throw error;
    }
    await notifyTask(taskId);
    await audit(uid, "attachment.create", { entity: "attachment", entityId: id, summary: file.original });
    return NextResponse.json({ id }, { status: 201 });
  } finally {
    if (staged) await unlinkIfPresent(temporary).catch((error) => console.error("attachment staging cleanup failed", error));
  }
});
