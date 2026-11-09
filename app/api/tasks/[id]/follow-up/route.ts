import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withTask } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { logEvent } from "@/lib/repositories/tasks";
import { notifyProject } from "@/lib/notify";
import { emitTaskEvent } from "@/lib/domain/events";

/** Create a follow-up task in the same project/section. */
export const POST = withTask("edit", async (_req, { taskId, uid, projectId }) => {
  if (!projectId) return NextResponse.json({ error: "task has no project" }, { status: 400 });
  const source = await db.query(
    `SELECT project_id, section_id, parent_task_id, name, assignee_id
     FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL`,
    [taskId],
  );
  if (source.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const t = source.rows[0] as {
    project_id: number;
    section_id: number | null;
    parent_task_id: number | null;
    name: string;
    assignee_id: number | null;
  };
  const name = `フォローアップ: ${t.name}`.slice(0, 255);
  const inserted = await db.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, description, assignee_id,
       created_by, completed, progress, status, position
     ) VALUES (
       $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::bigint,
       $7::bigint, FALSE, 0, 'inbox',
       COALESCE((SELECT MAX(position) FROM tasks
         WHERE project_id = $1::bigint AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
           AND COALESCE(parent_task_id,-1) = COALESCE($3::bigint,-1)), 0) + 1000
     ) RETURNING id`,
    [
      t.project_id,
      t.section_id,
      t.parent_task_id,
      name,
      `元タスク: ${t.name}`,
      t.assignee_id,
      uid,
    ],
  );
  const newId = Number(inserted.rows[0].id);
  await logEvent(newId, uid, "created", "フォローアップタスクを作成しました").catch(() => undefined);
  await audit(uid, "task.follow_up", {
    entity: "task",
    entityId: newId,
    projectId,
    summary: `from ${taskId}`,
  });
  await notifyProject(projectId);
  await emitTaskEvent({
    projectId,
    taskId: newId,
    actorId: uid,
    type: "task.created",
    data: { follow_up_of: taskId },
  }).catch(() => undefined);
  return NextResponse.json({ id: newId }, { status: 201 });
});
