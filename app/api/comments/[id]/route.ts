import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { mentionedUserIds, replaceCommentMentions } from "@/lib/mentions";

type CommentOwner = {
  id: number;
  task_id: number;
  author_id: number | null;
  project_id: number | null;
};

async function loadComment(id: number): Promise<CommentOwner | null> {
  const r = await db.query(
    `SELECT c.id, c.task_id, c.author_id, t.project_id
     FROM comments c JOIN tasks t ON t.id = c.task_id
     WHERE c.id = $1::bigint`,
    [id],
  );
  return (r.rows[0] as CommentOwner | undefined) ?? null;
}

async function canMutate(req: Request, comment: CommentOwner) {
  const uid = getCurrentUserIdFromRequest(req);
  const isAuthor = comment.author_id === uid;
  const auth = await requireProjectPermission(
    req,
    Number(comment.project_id),
    isAuthor ? "comment" : "admin",
  );
  return { uid, isAuthor, auth };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const commentId = Number(id);
  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "invalid comment id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (text === "") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  const comment = await loadComment(commentId);
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { uid, auth } = await canMutate(req, comment);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    `UPDATE comments SET body = $2, edited_at = now()
     WHERE id = $1::bigint RETURNING id, body, edited_at::text AS edited_at`,
    [commentId, text],
  );
  const mentionIds = await mentionedUserIds(comment.project_id, text);
  await replaceCommentMentions(commentId, mentionIds);
  await notifyTask(comment.task_id);
  await audit(uid, "comment.update", {
    entity: "comment",
    entityId: commentId,
    projectId: comment.project_id,
    summary: text.slice(0, 120),
  });
  return NextResponse.json(r.rows[0]);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const commentId = Number(id);
  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "invalid comment id" }, { status: 400 });
  }
  const comment = await loadComment(commentId);
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { uid, auth } = await canMutate(req, comment);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await db.query("DELETE FROM comments WHERE id = $1::bigint", [commentId]);
  await notifyTask(comment.task_id);
  await audit(uid, "comment.delete", {
    entity: "comment",
    entityId: commentId,
    projectId: comment.project_id,
  });
  return NextResponse.json({ deleted: commentId });
}
