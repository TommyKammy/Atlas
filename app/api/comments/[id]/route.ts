import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { replaceCommentMentions } from "@/lib/mentions";
import { parseCommentPayload } from "@/lib/comment-payload";

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

async function canMutate(req: Request, uid: number, comment: CommentOwner) {
  const isAuthor = comment.author_id === uid;
  const auth = await requireProjectPermission(
    req,
    Number(comment.project_id),
    isAuthor ? "comment" : "admin",
  );
  return { uid, isAuthor, auth };
}

export const PATCH = withUser(async (req, { uid, params }) => {
  const commentId = Number(params.id);
  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "invalid comment id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const comment = await loadComment(commentId);
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { auth } = await canMutate(req, uid, comment);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = await parseCommentPayload(comment.project_id, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const r = await db.query(
    `UPDATE comments SET body = $2, body_doc = $3::jsonb, edited_at = now()
     WHERE id = $1::bigint
     RETURNING id, body, body_doc, edited_at::text AS edited_at`,
    [commentId, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
  );
  await replaceCommentMentions(commentId, parsed.mentionIds);
  await notifyTask(comment.task_id);
  await audit(uid, "comment.update", {
    entity: "comment",
    entityId: commentId,
    projectId: comment.project_id,
    summary: parsed.text.slice(0, 120),
  });
  return NextResponse.json(r.rows[0]);
});

export const DELETE = withUser(async (req, { uid, params }) => {
  const commentId = Number(params.id);
  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "invalid comment id" }, { status: 400 });
  }
  const comment = await loadComment(commentId);
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { auth } = await canMutate(req, uid, comment);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await db.query("DELETE FROM comments WHERE id = $1::bigint", [commentId]);
  await notifyTask(comment.task_id);
  await audit(uid, "comment.delete", {
    entity: "comment",
    entityId: commentId,
    projectId: comment.project_id,
  });
  return NextResponse.json({ deleted: commentId });
});
