import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withTask } from "@/lib/api/route";
import { mentionedUserIds, replaceCommentMentions } from "@/lib/mentions";

export const POST = withTask("comment", async (_req, { taskId: task_id, uid, projectId: taskProjectId, body }) => {
  const text = (body as { body?: unknown } | null)?.body;
  if (!text || String(text).trim() === "") {
    return NextResponse.json({ error: "task_id and body are required" }, { status: 400 });
  }
  const r = await db.query(
    "INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
    [task_id, uid, String(text).trim()],
  );
  const mentionIds = await mentionedUserIds(taskProjectId, String(text));
  await replaceCommentMentions(r.rows[0].id, mentionIds);
  await notifyTask(task_id);
  await audit(uid, "comment.create", { entity: "comment", entityId: r.rows[0].id, summary: String(text).trim().slice(0, 120) });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
