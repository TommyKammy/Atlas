import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withTask } from "@/lib/api/route";
import { replaceCommentMentions } from "@/lib/mentions";
import { parseCommentPayload } from "@/lib/comment-payload";
import { emitTaskEvent } from "@/lib/domain/events";

export const POST = withTask("comment", async (_req, { taskId: task_id, uid, projectId: taskProjectId, body }) => {
  const parsed = await parseCommentPayload(taskProjectId, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const id = await withTransaction(async (q) => {
    const r = await q.query(
      `INSERT INTO comments (task_id, author_id, body, body_doc)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [task_id, uid, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
    );
    const commentId = Number(r.rows[0].id);
    await replaceCommentMentions(commentId, parsed.mentionIds, q);
    await emitTaskEvent({
      projectId: taskProjectId,
      taskId: task_id,
      actorId: uid,
      type: "comment.created",
      data: { comment_id: commentId, body: parsed.text.slice(0, 500) },
    }, q);
    return commentId;
  });
  await notifyTask(task_id);
  await audit(uid, "comment.create", {
    entity: "comment",
    entityId: id,
    summary: parsed.text.slice(0, 120),
  });
  return NextResponse.json({ id }, { status: 201 });
}, { body: true });
