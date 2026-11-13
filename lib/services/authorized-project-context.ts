import { withTransaction } from "../db";
import { forbidden, notFound } from "../api/errors";
import { assertDataActor, projectDataAccess, type DataActor } from "../data-actor";
import { projectTaskReadScope } from "../repositories/scope";
import type { RichTextDoc } from "../rich-text-types";

export type PartnerNote = { id: number; title: string; body: string; body_doc: RichTextDoc | null; revision: number; updated_at: string };
export type PartnerTask = { id: number; name: string; description: string; assignee: string | null; completed: boolean; completed_at: string | null; start_on: string | null; due_on: string | null; status: string; updated_at: string; created_at: string };
export type PartnerFacts = { total: number; completed: number; overdue: number; unassigned: number; without_due: number; inactive: number; completed_in_period: number; created_in_period: number; updated_in_period: number; due_next_week: number; version: string };
export type PartnerSnapshot = {
  project: { id: number; name: string; description: string; status: string };
  sections?: { id: number; name: string }[];
  note?: PartnerNote; facts?: PartnerFacts; tasks: PartnerTask[]; notes: PartnerNote[];
  comments: { id: number; task_id: number; body: string; created_at: string }[];
  dependencies: { task_id: number; depends_on_id: number }[];
  totals: { notes: number; comments: number; dependencies: number };
};

/** One consistent read-only snapshot. Every query is scoped to a live project and actor.
 * Cross-project dependency endpoints are excluded even if an admin can view them.
 */
export async function readPartnerSnapshot(projectId: number, actor: DataActor, at: string, noteId?: number): Promise<PartnerSnapshot> {
  assertDataActor(actor);
  return withTransaction(async q => {
    await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const project = (await q.query(`SELECT p.id,p.name,COALESCE(p.description,'') AS description,p.status FROM projects p
      WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", "edit")}`, [projectId, actor.userId])).rows[0];
    if (!project) throw forbidden("このプロジェクトをAIで確認する権限がありません");
    const result: PartnerSnapshot = { project, tasks: [], notes: [], comments: [], dependencies: [], totals: { notes: 0, comments: 0, dependencies: 0 } };
    const noteSelect = `SELECT k.id,k.title,k.body,k.body_doc,k.revision,k.updated_at::text FROM project_knowledge k
      JOIN projects p ON p.id=k.project_id WHERE p.id=$1 AND k.deleted_at IS NULL AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", "edit")}`;
    if (noteId !== undefined) {
      const note = (await q.query(`${noteSelect} AND k.id=$3`, [projectId, actor.userId, noteId])).rows[0];
      if (!note) throw notFound("このプロジェクトのノートが見つかりません");
      result.note = note;
      result.sections = (await q.query("SELECT id,name FROM sections WHERE project_id=$1 ORDER BY position,id", [projectId])).rows;
      return result;
    }
    const args = [projectId, actor.userId, at];
    const scope = `WITH scoped AS (SELECT t.* FROM tasks t JOIN projects p ON p.id=$1
      WHERE p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", "edit")}
        AND t.deleted_at IS NULL AND ${projectTaskReadScope("t")}
        AND (t.parent_task_id IS NULL OR EXISTS (SELECT 1 FROM tasks parent WHERE parent.id=t.parent_task_id AND parent.deleted_at IS NULL)))`;
    result.facts = (await q.query(`${scope} SELECT count(*)::int AS total,
      count(*) FILTER (WHERE completed)::int AS completed,
      count(*) FILTER (WHERE NOT completed AND due_on < ($3::timestamptz AT TIME ZONE 'Asia/Tokyo')::date)::int AS overdue,
      count(*) FILTER (WHERE NOT completed AND assignee_id IS NULL)::int AS unassigned,
      count(*) FILTER (WHERE NOT completed AND due_on IS NULL)::int AS without_due,
      count(*) FILTER (WHERE NOT completed AND updated_at < $3::timestamptz-interval '7 days')::int AS inactive,
      count(*) FILTER (WHERE completed AND completed_at >= $3::timestamptz-interval '7 days' AND completed_at <= $3::timestamptz)::int AS completed_in_period,
      count(*) FILTER (WHERE created_at >= $3::timestamptz-interval '7 days' AND created_at <= $3::timestamptz)::int AS created_in_period,
      count(*) FILTER (WHERE updated_at >= $3::timestamptz-interval '7 days' AND updated_at <= $3::timestamptz)::int AS updated_in_period,
      count(*) FILTER (WHERE NOT completed AND due_on BETWEEN ($3::timestamptz AT TIME ZONE 'Asia/Tokyo')::date AND ($3::timestamptz AT TIME ZONE 'Asia/Tokyo')::date+6)::int AS due_next_week,
      md5(COALESCE(string_agg(to_jsonb(scoped)::text,E'\n' ORDER BY id),'')) AS version FROM scoped`, args)).rows[0];
    result.tasks = (await q.query(`${scope} SELECT t.id,t.name,left(t.description,600) AS description,u.name AS assignee,t.completed,
      t.completed_at::text,t.start_on::text,t.due_on::text,t.status,t.updated_at::text,t.created_at::text
      FROM scoped t LEFT JOIN users u ON u.id=t.assignee_id
      ORDER BY (NOT t.completed AND t.due_on < ($3::timestamptz AT TIME ZONE 'Asia/Tokyo')::date) DESC NULLS LAST,
      t.updated_at DESC,t.id LIMIT 100`, args)).rows;
    const ids = result.tasks.map(t => t.id);
    result.dependencies = (await q.query(`${scope} SELECT d.task_id,d.depends_on_id FROM task_dependencies d
      JOIN scoped t ON t.id=d.task_id JOIN scoped predecessor ON predecessor.id=d.depends_on_id
      WHERE d.task_id=ANY($3::bigint[]) AND d.depends_on_id=ANY($3::bigint[]) ORDER BY d.task_id,d.depends_on_id LIMIT 200`, [projectId, actor.userId, ids])).rows;
    result.totals.dependencies = (await q.query(`${scope} SELECT count(*)::int AS count FROM task_dependencies d
      JOIN scoped t ON t.id=d.task_id JOIN scoped predecessor ON predecessor.id=d.depends_on_id`, [projectId, actor.userId])).rows[0].count;
    result.comments = (await q.query(`${scope} SELECT c.id,c.task_id,left(c.body,600) AS body,c.created_at::text FROM comments c JOIN scoped t ON t.id=c.task_id
      WHERE c.created_at >= $3::timestamptz-interval '7 days' AND c.created_at <= $3::timestamptz
      ORDER BY c.created_at DESC,c.id DESC LIMIT 20`, args)).rows;
    result.totals.comments = (await q.query(`${scope} SELECT count(*)::int AS count FROM comments c JOIN scoped t ON t.id=c.task_id
      WHERE c.created_at >= $3::timestamptz-interval '7 days' AND c.created_at <= $3::timestamptz`, args)).rows[0].count;
    result.notes = (await q.query(`${noteSelect} ORDER BY k.updated_at DESC,k.id DESC LIMIT 12`, [projectId, actor.userId])).rows;
    result.totals.notes = (await q.query(`SELECT count(*)::int AS count FROM project_knowledge k JOIN projects p ON p.id=k.project_id
      WHERE p.id=$1 AND k.deleted_at IS NULL AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", "edit")}`, [projectId, actor.userId])).rows[0].count;
    return result;
  });
}
