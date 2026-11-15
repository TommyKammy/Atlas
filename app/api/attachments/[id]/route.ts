import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { db, withTransaction } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withAttachmentTask } from "@/lib/api/route";
import { pruneUnreferencedAttachment, UPLOAD_DIR } from "@/lib/attachment-files.mjs";

import { TEXT_PREVIEW_TYPES, TEXT_PREVIEW_BYTES } from "@/lib/attachment-preview";

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export const GET = withAttachmentTask("view", async (req, { params }) => {
  const id = params.id;
  const query = new URL(req.url).searchParams;
  const inline = query.get("inline") === "1";
  const preview = query.get("preview") === "1";
  const r = await db.query(
    "SELECT file_name, stored_name, mime_type, size_bytes, task_id FROM task_attachments WHERE id = $1::bigint",
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = r.rows[0];
  if (preview && !TEXT_PREVIEW_TYPES.has(row.mime_type)) {
    return NextResponse.json({ error: "text preview unavailable" }, { status: 400 });
  }
  const full = path.join(UPLOAD_DIR, path.basename(row.stored_name));
  let file;
  try {
    file = await open(full, "r");
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 410 });
  }
  if (preview) {
    try {
      const buffer = Buffer.alloc(TEXT_PREVIEW_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return new NextResponse(new Uint8Array(buffer.subarray(0, bytesRead)), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": String(bytesRead),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } finally {
      await file.close();
    }
  }
  // The adapter counts chunks by default, so explicitly bound its queue.
  const body = Readable.toWeb(file.createReadStream(), { strategy: { highWaterMark: 1 } }) as ReadableStream<Uint8Array>;
  // SVG/HTML stay attachments (scriptable). Only allowlisted types render inline.
  const canInline = inline && INLINE_TYPES.has(row.mime_type);
  return new NextResponse(body, {
    headers: {
      "Content-Type": row.mime_type,
      "Content-Length": String(row.size_bytes),
      "Content-Disposition": canInline
        ? "inline"
        : `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    },
  });
});

export const DELETE = withAttachmentTask("edit", async (_req, { uid, taskId, params }) => {
  const id = params.id;
  const r = await db.query(
    "DELETE FROM task_attachments WHERE id = $1::bigint RETURNING stored_name",
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await withTransaction((client) => pruneUnreferencedAttachment(client, r.rows[0].stored_name))
    .catch((error) => console.error("attachment delete cleanup failed", error));
  await notifyTask(taskId);
  await audit(uid, "attachment.delete", { entity: "attachment", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
});
