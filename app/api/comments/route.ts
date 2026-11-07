import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withTask } from "@/lib/api/route";
import { replaceCommentMentions } from "@/lib/mentions";
import { parseCommentPayload } from "@/lib/comment-payload";

export const POST = withTask("comment", async (_req, { taskId: task_id, uid, projectId: taskProjectId, body }) => {
  const parsed = await parseCommentPayload(taskProjectId, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const r = await db.query(
    `INSERT INTO comments (task_id, author_id, body, body_doc)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [task_id, uid, parsed.markdown, parsed.doc ? JSON.stringify(parsed.doc) : null],
  );
  await replaceCommentMentions(r.rows[0].id, parsed.mentionIds);
  await notifyTask(task_id);
  await audit(uid, "comment.create", {
    entity: "comment",
    entityId: r.rows[0].id,
    summary: parsed.text.slice(0, 120),
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
