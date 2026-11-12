import { withTransaction, type Queryable } from "../db";
import { badRequest, conflict, notFound, forbidden } from "../api/errors";
import { knowledgeMarkdown, validateKnowledgeDoc } from "../knowledge-document";
import { moveKnowledgeId } from "../knowledge-order";
import { readKnowledge } from "./authorized-data";
import { assertDataActor, projectDataAccess } from "../data-actor";

async function lockEditableProject(projectId: number, uid: number, q: Queryable) {
  assertDataActor({ userId: uid });
  const result = await q.query(`SELECT p.id FROM projects p WHERE p.id = $1
    AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", "edit")} FOR UPDATE`, [projectId, uid]);
  if (!result.rowCount) throw forbidden("プロジェクトを編集する権限がありません");
}

function payload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("ノートの形式が無効です");
  return value as Record<string, unknown>;
}
function title(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw badRequest("タイトルは1〜300文字で入力してください");
  return value.trim();
}
function content(input: Record<string, unknown>) {
  if ("body_doc" in input) {
    try {
      const doc = validateKnowledgeDoc(input.body_doc);
      return { body: knowledgeMarkdown(doc), doc };
    } catch (error) { throw badRequest(error instanceof Error ? error.message : "本文が無効です"); }
  }
  if (typeof input.body !== "string" || input.body.length > 100_000) throw badRequest("本文は10万文字以内で入力してください");
  return { body: input.body, doc: null };
}

export async function createKnowledge(projectId: number, uid: number, value: unknown, beforeCreate?: (q: Queryable) => Promise<void>) {
  const input = payload(value), name = title(input.title), text = content(input);
  const key = input.create_key;
  if (key !== undefined && (typeof key !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))) throw badRequest("作成キーが無効です");
  return withTransaction(async q => {
    // Serialize appends with reordering; new notes are always added at the end.
    await lockEditableProject(projectId, uid, q);
    if (beforeCreate) await beforeCreate(q);
    const inserted = await q.query(`INSERT INTO project_knowledge (project_id, author_id, title, body, body_doc, create_key, position)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6,
        (SELECT COALESCE(MAX(position), 0) + 1 FROM project_knowledge WHERE project_id = $1 AND deleted_at IS NULL))
      ON CONFLICT (create_key) DO NOTHING RETURNING id`,
    [projectId, uid, name, text.body, text.doc === null ? null : JSON.stringify(text.doc), key ?? null]);
    let id = inserted.rows[0]?.id;
    if (!id) {
      const previous = await q.query("SELECT id FROM project_knowledge WHERE create_key = $1 AND project_id = $2 AND author_id = $3 AND deleted_at IS NULL", [key, projectId, uid]);
      id = previous.rows[0]?.id;
      if (!id) throw conflict("作成キーが使用済みです");
    }
    return readKnowledge(id, { userId: uid }, q);
  });
}

export async function reorderKnowledge(projectId: number, uid: number, value: unknown) {
  const input = payload(value);
  const id = input.note_id, target = input.target_id, placement = input.placement;
  if (![id, target].every(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (placement !== "before" && placement !== "after")) throw badRequest("並べ替え先が無効です");
  return withTransaction(async q => {
    await lockEditableProject(projectId, uid, q);
    const rows = await q.query("SELECT id FROM project_knowledge WHERE project_id = $1 AND deleted_at IS NULL ORDER BY position, id", [projectId]);
    const previous = rows.rows.map(row => row.id as number);
    if (!previous.includes(id as number) || !previous.includes(target as number)) throw notFound("ノートが見つかりません");
    const order = moveKnowledgeId(previous, id as number, target as number, placement);
    const changed = order.some((noteId, index) => noteId !== previous[index]);
    if (changed) await q.query(`UPDATE project_knowledge k SET position = ordered.position
      FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(id, position)
      WHERE k.project_id = $1 AND k.id = ordered.id AND k.position IS DISTINCT FROM ordered.position`, [projectId, order]);
    return { order, changed };
  });
}

export async function updateKnowledge(id: number, uid: number, value: unknown) {
  const input = payload(value);
  if (!("title" in input || "body" in input || "body_doc" in input || "restore_revision" in input)) throw badRequest("変更内容がありません");
  if (input.expected_revision !== undefined && (!Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 0)) throw badRequest("リビジョンが無効です");
  return withTransaction(async q => {
    const owner = await q.query("SELECT project_id FROM project_knowledge WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!owner.rowCount) throw notFound("ノートが見つかりません");
    await lockEditableProject(owner.rows[0].project_id, uid, q);
    await q.query("SELECT id FROM project_knowledge WHERE id = $1 FOR UPDATE", [id]);
    const current = await readKnowledge(id, { userId: uid }, q);
    if ((input.body_doc !== undefined || current.body_doc || input.restore_revision !== undefined) && input.expected_revision === undefined) throw conflict("最新版を取得してから保存してください");
    if (input.expected_revision !== undefined && input.expected_revision !== current.revision) throw conflict("別の画面で更新されています。変更をコピーしてから最新版を開いてください");
    let nextTitle = "title" in input ? title(input.title) : current.title;
    let next = "body_doc" in input || "body" in input ? content(input) : { body: current.body, doc: current.body_doc };
    if ("restore_revision" in input) {
      if (!Number.isInteger(input.restore_revision)) throw badRequest("履歴が無効です");
      const old = await q.query("SELECT title, body, body_doc FROM knowledge_revisions WHERE knowledge_id = $1 AND revision = $2", [id, input.restore_revision]);
      if (!old.rows[0]) throw notFound("履歴が見つかりません");
      nextTitle = old.rows[0].title;
      next = { body: old.rows[0].body, doc: old.rows[0].body_doc };
    }
    await q.query(`INSERT INTO knowledge_revisions (knowledge_id, revision, title, body, body_doc, saved_at, archived_by)
      SELECT id, revision, title, body, body_doc, updated_at, $2 FROM project_knowledge WHERE id = $1`, [id, uid]);
    await q.query(`UPDATE project_knowledge SET title = $2, body = $3, body_doc = $4::jsonb,
      revision = revision + 1, updated_at = now() WHERE id = $1`, [id, nextTitle, next.body, next.doc === null ? null : JSON.stringify(next.doc)]);
    return readKnowledge(id, { userId: uid }, q);
  });
}

/** Keep the body and every revision. A new revision invalidates pre-trash editors. */
async function changeTrashState(id: number, uid: number, expectedRevision: unknown, restore: boolean) {
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) throw badRequest("ノートのリビジョンが必要です");
  return withTransaction(async q => {
    const owner = await q.query("SELECT project_id FROM project_knowledge WHERE id = $1", [id]);
    if (!owner.rowCount) throw notFound("ノートが見つかりません");
    const projectId = owner.rows[0].project_id;
    // Match create/reorder/update lock order, including concurrent restores.
    await lockEditableProject(projectId, uid, q);
    const result = await q.query("SELECT revision, deleted_at FROM project_knowledge WHERE id = $1 FOR UPDATE", [id]);
    const current = result.rows[0];
    if (!current) throw notFound("ノートが見つかりません");
    if (current.revision !== expectedRevision || (current.deleted_at !== null) !== restore) {
      throw conflict("別の画面で更新されています。最新版を開いてください");
    }
    await q.query(`INSERT INTO knowledge_revisions (knowledge_id, revision, title, body, body_doc, saved_at, archived_by)
      SELECT id, revision, title, body, body_doc, updated_at, $2 FROM project_knowledge WHERE id = $1`, [id, uid]);
    if (restore) {
      await q.query(`UPDATE project_knowledge SET deleted_at = NULL, deleted_by = NULL, revision = revision + 1,
        position = (SELECT COALESCE(MAX(position), 0) + 1 FROM project_knowledge WHERE project_id = $2 AND deleted_at IS NULL)
        WHERE id = $1`, [id, projectId]);
    } else {
      await q.query("UPDATE project_knowledge SET deleted_at = now(), deleted_by = $2, revision = revision + 1 WHERE id = $1", [id, uid]);
    }
    return restore ? readKnowledge(id, { userId: uid }, q) : { deleted: id };
  });
}

export const trashKnowledge = (id: number, uid: number, expectedRevision: unknown) => changeTrashState(id, uid, expectedRevision, false);
export const restoreKnowledge = (id: number, uid: number, expectedRevision: unknown) => changeTrashState(id, uid, expectedRevision, true);
