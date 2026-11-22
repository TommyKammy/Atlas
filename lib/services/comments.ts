import { badRequest } from "../api/errors";
import { withTransaction } from "../db";
import { notifyTask } from "../notify";
import { audit } from "../audit";
import { replaceCommentMentions } from "../mentions";
import { parseCommentPayload } from "../comment-payload";
import { emitTaskEvent } from "../domain/events";
import { requireTaskAccess, type Actor } from "./actor";

/**
 * Add a comment for an actor that need not come from an HTTP session.
 * The task's project is re-resolved from the actor's live permissions.
 */
export async function addComment(
  actor: Actor,
  input: { task_id: unknown; [key: string]: unknown },
): Promise<{ id: number }> {
  const taskId = Number(input.task_id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const auth = await requireTaskAccess(actor, taskId, "comment");
  const taskProjectId = auth.projectId;
  const parsed = await parseCommentPayload(taskProjectId, input);
  if (!parsed.ok) throw badRequest(parsed.error);

  const id = await withTransaction(async (q) => {
    const r = await q.query(
      `INSERT INTO comments (task_id, author_id, body, body_doc)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [taskId, actor.uid, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
    );
    const commentId = Number(r.rows[0].id);
    await replaceCommentMentions(commentId, parsed.mentionIds, q);
    await emitTaskEvent({
      projectId: taskProjectId,
      taskId,
      actorId: actor.uid,
      type: "comment.created",
      data: { comment_id: commentId, body: parsed.text.slice(0, 500) },
    }, q);
    return commentId;
  });
  await notifyTask(taskId);
  await audit(actor.uid, "comment.create", {
    entity: "comment",
    entityId: id,
    summary: parsed.text.slice(0, 120),
  });
  return { id };
}
