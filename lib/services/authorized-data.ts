/** Public, session-actor-required read gateway. No cached permissions or admin fallback.
 * Server routes/pages supply the authenticated user's identity. Future consumers
 * use this module rather than querying domain tables directly.
 */
import { db, type Queryable } from "../db";
import { badRequest, notFound } from "../api/errors";
import { assertDataActor, projectDataAccess, type DataActor } from "../data-actor";
import type { ProjectKnowledge } from "../repositories/projects";

export type { DataActor } from "../data-actor";
export { readPartnerSnapshot } from "./authorized-project-context";
export {
  getSearchCustomFields, searchTasksAdvanced, searchProjectsGlobal, searchMessagesGlobal,
  searchKnowledgeGlobal, searchFilesGlobal,
} from "../repositories/search";

export const knowledgeColumns = `k.id, k.title, k.body, k.body_doc, k.revision, k.position,
  k.created_at::text AS created_at, k.updated_at::text AS updated_at,
  (SELECT name FROM users WHERE id = k.author_id) AS author_name`;

export type TrashedKnowledge = ProjectKnowledge & { deleted_at: string; deleted_by_name: string | null };

export async function readKnowledge(id: number, actor: DataActor, q: Queryable = db): Promise<ProjectKnowledge> {
  assertDataActor(actor);
  const result = await q.query(`SELECT ${knowledgeColumns} FROM project_knowledge k
    JOIN projects p ON p.id = k.project_id
    WHERE k.id = $1 AND k.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${projectDataAccess("p", "$2")}`, [id, actor.userId]);
  if (!result.rows[0]) throw notFound("ノートが見つかりません");
  return result.rows[0];
}

export async function listKnowledge(projectId: number, actor: DataActor,
  options: { query?: string; offset?: number } = {}, q: Queryable = db): Promise<ProjectKnowledge[]> {
  assertDataActor(actor);
  const query = options.query ?? "", offset = options.offset ?? 0;
  if (query.length > 300 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw badRequest("検索条件が無効です");
  const result = await q.query(`SELECT ${knowledgeColumns} FROM project_knowledge k
    JOIN projects p ON p.id = k.project_id
    WHERE k.project_id = $1 AND k.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${projectDataAccess("p", "$2")}
      AND ($3 = '' OR position(lower($3) in lower(k.title || E'\\n' || k.body)) > 0)
    ORDER BY k.position, k.id LIMIT 100 OFFSET $4`, [projectId, actor.userId, query, offset]);
  return result.rows;
}

export async function getProjectKnowledge(projectId: number, actor: DataActor, selectedNoteId?: number): Promise<ProjectKnowledge[]> {
  const rows = await listKnowledge(projectId, actor);
  if (selectedNoteId && Number.isSafeInteger(selectedNoteId) && selectedNoteId > 0 && !rows.some(row => row.id === selectedNoteId)) {
    const selected = await db.query(`SELECT ${knowledgeColumns} FROM project_knowledge k
      JOIN projects p ON p.id = k.project_id WHERE k.project_id = $1 AND k.id = $2
      AND k.deleted_at IS NULL AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$3")}`,
    [projectId, selectedNoteId, actor.userId]);
    rows.push(...selected.rows);
    rows.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return rows;
}

export async function readKnowledgeHistory(id: number, actor: DataActor, q: Queryable = db) {
  await readKnowledge(id, actor, q);
  // The same predicate protects history even if membership changes after the read.
  const result = await q.query(`SELECT r.revision, r.title, r.saved_at::text AS saved_at
    FROM knowledge_revisions r JOIN project_knowledge k ON k.id = r.knowledge_id
    JOIN projects p ON p.id = k.project_id
    WHERE k.id = $1 AND k.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${projectDataAccess("p", "$2")}
      AND (r.revision = 0 OR r.revision IN
        (SELECT revision FROM knowledge_revisions WHERE knowledge_id = $1 ORDER BY revision DESC LIMIT 50))
    ORDER BY r.revision DESC`, [id, actor.userId]);
  return result.rows;
}

/** Trash is intentionally a separate, edit-authorized read surface. */
export async function listKnowledgeTrash(projectId: number, actor: DataActor, offset = 0, q: Queryable = db): Promise<TrashedKnowledge[]> {
  assertDataActor(actor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw badRequest("検索条件が無効です");
  const result = await q.query(`SELECT ${knowledgeColumns}, k.deleted_at::text AS deleted_at,
    (SELECT name FROM users WHERE id = k.deleted_by) AS deleted_by_name
    FROM project_knowledge k JOIN projects p ON p.id = k.project_id
    WHERE k.project_id = $1 AND k.deleted_at IS NOT NULL AND p.deleted_at IS NULL
      AND ${projectDataAccess("p", "$2", "edit")}
    ORDER BY k.deleted_at DESC, k.id DESC LIMIT 100 OFFSET $3`, [projectId, actor.userId, offset]);
  return result.rows;
}
