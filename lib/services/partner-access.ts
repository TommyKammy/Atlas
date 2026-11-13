import type { Queryable } from "../db";
import { forbidden } from "../api/errors";
import { projectDataAccess } from "../data-actor";

export async function readPartnerProject(q: Queryable, projectId: number, uid: number, level: "view" | "edit") {
  const p = (await q.query(`SELECT p.id,p.name FROM projects p WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2", level)}`, [projectId, uid])).rows[0];
  if (!p) throw forbidden("このプロジェクトへの権限がありません");
  return p as { id: number; name: string };
}
/** Membership changes also lock projects first. Hold access through the commit. */
export async function lockPartnerProject(q: Queryable, projectId: number, uid: number) {
  await q.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [projectId]);
  await q.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [uid]);
  return readPartnerProject(q, projectId, uid, "edit");
}
