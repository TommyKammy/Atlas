import type { Queryable } from "../db";
import type { RichTextDoc } from "../rich-text-types";
import { emitTaskEvent } from "../domain/events";
import { notifyProject } from "../notify";
import { audit } from "../audit";
import { logEvent } from "../repositories/tasks";
import { runAutomations } from "../automation-runner";

type NewTask = { projectId: number; sectionId: number | null; parentId: number | null; name: string; description?: string; descriptionDoc?: RichTextDoc; start: string | null; due: string | null; assigneeId: number | null; uid: number; isMilestone: boolean };
/** Shared by manual creation and approved AI proposals. Caller validates and authorizes. */
export async function insertTask(q: Queryable, t: NewTask): Promise<number> {
  const r = await q.query(`INSERT INTO tasks (project_id,section_id,parent_task_id,name,description,position,start_on,due_on,assignee_id,created_by,is_milestone,description_doc)
    VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position),0)+1000 FROM tasks WHERE COALESCE(project_id,-1)=COALESCE($1::bigint,-1)
      AND COALESCE(section_id,-1)=COALESCE($2::bigint,-1) AND COALESCE(parent_task_id,-1)=COALESCE($3::bigint,-1)),$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
  [t.projectId,t.sectionId,t.parentId,t.name,t.description ?? "",t.start,t.due,t.assigneeId,t.uid,t.isMilestone,t.descriptionDoc ? JSON.stringify(t.descriptionDoc) : null]);
  const id = Number(r.rows[0].id);
  await emitTaskEvent({ projectId: t.projectId, taskId: id, actorId: t.uid, type: "task.created",
    data: { name: t.name, section_id: t.sectionId, assignee_id: t.assigneeId, parent_task_id: t.parentId, is_milestone: t.isMilestone } }, q);
  return id;
}
export async function afterTaskCreated(projectId: number, taskId: number, uid: number, name: string) {
  await notifyProject(projectId);
  await audit(uid, "task.create", { entity: "task", entityId: taskId, projectId, summary: name });
  await logEvent(taskId, uid, "created", "タスクを作成しました").catch(() => undefined);
  await runAutomations(projectId, taskId, "task_created").catch(() => undefined);
}
