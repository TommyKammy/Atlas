import { audit } from "../audit";
import { parseCommentPayload } from "../comment-payload";
import { db } from "../db";
import { emitTaskEvent } from "../domain/events";
import { replaceCommentMentions } from "../mentions";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, assertEdit, taskProject } from "./shared";

export async function taskAddComment(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.add_comment requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  const body = typeof params.body === "string" ? params.body : "";
  const parsed = await parseCommentPayload(projectId, { body }, q);
  if (!parsed.ok) throw new Error(parsed.error);
  const inserted = await q.query(
    `INSERT INTO comments (task_id, author_id, body, body_doc)
     VALUES ($1::bigint, $2, $3, $4::jsonb) RETURNING id`,
    [taskId, ctx.actorId, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
  );
  const commentId = Number(inserted.rows[0].id);
  await replaceCommentMentions(commentId, parsed.mentionIds, q);
  await audit(ctx.actorId, "automation.comment.create", {
    entity: "comment",
    entityId: commentId,
    projectId,
    summary: parsed.text.slice(0, 120),
  }, q);
  ctx.notifyAfterCommit?.(projectId);
  await emitTaskEvent({
    projectId,
    taskId,
    actorId: ctx.actorId,
    type: "comment.created",
    data: { comment_id: commentId, body: parsed.text.slice(0, 500) },
    causationId: ctx.eventId ?? null,
    automationRuleId: ctx.ruleId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  }, q);
  return { summary: "コメントを追加しました", data: { comment_id: commentId } };
}
