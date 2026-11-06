import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const r = await db.query(
    "SELECT file_name, stored_name, mime_type, size_bytes, task_id FROM task_attachments WHERE id = $1::bigint",
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const projectId = await getTaskProjectId(r.rows[0].task_id);
  if (projectId !== null) {
    const auth = await requireProjectPermission(req, projectId, "view");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const row = r.rows[0];
  const full = path.join(UPLOAD_DIR, path.basename(row.stored_name));
  let data: Buffer;
  try {
    data = await import("node:fs/promises").then((fs) => fs.readFile(full));
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 410 });
  }
  const body = new Uint8Array(data);
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
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT task_id FROM task_attachments WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const projectId = await getTaskProjectId(owner.rows[0].task_id);
  if (projectId !== null) {
    const auth = await requireProjectPermission(_req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const r = await db.query(
    "DELETE FROM task_attachments WHERE id = $1::bigint RETURNING stored_name",
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const full = path.join(UPLOAD_DIR, path.basename(r.rows[0].stored_name));
  await unlink(full).catch(() => undefined);
  await notifyTask(owner.rows[0]?.task_id ?? null);
  await audit(getCurrentUserIdFromRequest(_req), "attachment.delete", { entity: "attachment", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
}
