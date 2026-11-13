import { db, withTransaction, type Queryable } from "../db";
import { badRequest, conflict, notFound } from "../api/errors";
import { audit } from "../audit";
import { projectDataAccess } from "../data-actor";
import type { PartnerResponse } from "../project-partner";
import type { PartnerReportDetail, PartnerReportSummary } from "../partner-workflows";
import { lockPartnerProject, readPartnerProject } from "./partner-access";

export function partnerId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest("IDが無効です");
  return id;
}
const reportColumns = `r.id,r.skill,r.payload->>'summary' AS summary,r.created_at::text,
  r.payload->>'checked_at' AS checked_at,r.payload->>'period_start' AS period_start,
  u.name AS creator_name,v.name AS reviewer_name,r.reviewed_at::text`;
const reportJoins = `FROM partner_reports r JOIN projects p ON p.id=r.project_id
  LEFT JOIN users u ON u.id=r.created_by LEFT JOIN users v ON v.id=r.reviewed_by`;

export async function listPartnerReports(projectId: number, uid: number, before?: number) {
  await readPartnerProject(db, projectId, uid, "view");
  const rows = (await db.query(`SELECT ${reportColumns} ${reportJoins}
    WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2")}
      AND ($3::bigint IS NULL OR r.id<$3) ORDER BY r.id DESC LIMIT 6`, [projectId, uid, before ?? null])).rows as PartnerReportSummary[];
  const count = (await db.query(`SELECT count(*)::int AS total FROM partner_reports r JOIN projects p ON p.id=r.project_id
    WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2")}`, [projectId, uid])).rows[0];
  return { items: rows.slice(0, 5), next_cursor: rows.length > 5 ? rows[4].id : null, total: count.total };
}
async function reportDetail(q: Queryable, projectId: number, uid: number, id: number): Promise<PartnerReportDetail> {
  const row = (await q.query(`SELECT ${reportColumns},r.payload ${reportJoins}
    WHERE p.id=$1 AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$2")} AND r.id=$3`, [projectId, uid, id])).rows[0];
  if (!row) throw notFound("報告が見つからないか、閲覧権限がありません");
  const { payload, ...report } = row;
  return { report: report as PartnerReportSummary, result: { ...payload, report_id: id } };
}
export const readPartnerReport = (projectId: number, uid: number, id: number) => reportDetail(db, projectId, uid, id);

export async function reviewPartnerReport(projectId: number, uid: number, id: number, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || (value as { reviewed?: unknown }).reviewed !== true) throw badRequest("確認済みにする報告を選択してください");
  return withTransaction(async q => {
    await lockPartnerProject(q, projectId, uid);
    const r = await q.query("UPDATE partner_reports SET reviewed_by=$3,reviewed_at=now() WHERE project_id=$1 AND id=$2 AND reviewed_at IS NULL RETURNING id", [projectId, id, uid]);
    if (r.rowCount) await audit(uid, "partner.report.review", { entity: "project", entityId: projectId, projectId, summary: `AI報告 #${id} を確認済みにしました` }, q);
    return reportDetail(q, projectId, uid, id);
  });
}

/** A completed response and its run status commit together; incomplete output is never saved. */
export async function persistPartnerResult(projectId: number, uid: number, runId: string, result: PartnerResponse,
  source: { noteId?: number; revision?: number }, usage: { input_tokens: number | null; output_tokens: number | null; duration: number }, signal: AbortSignal) {
  return withTransaction(async q => {
    await lockPartnerProject(q, projectId, uid); signal.throwIfAborted();
    let response: PartnerResponse;
    if (result.skill === "action_extract") {
      const note = (await q.query("SELECT revision FROM project_knowledge WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE", [source.noteId, projectId])).rows[0];
      if (!note || note.revision !== source.revision) throw conflict("元ノートが更新・削除されています。もう一度抽出してください");
      await q.query(`INSERT INTO partner_action_batches(id,project_id,note_id,source_note_id,source_revision,created_by,actions) VALUES($1,$2,$3,$3,$4,$5,$6::jsonb)`,
        [runId, projectId, source.noteId, source.revision, uid, JSON.stringify(result.actions)]);
      response = { ...result, action_batch_id: runId };
    } else {
      const r = await q.query(`INSERT INTO partner_reports(project_id,run_id,skill,payload,created_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,
        [projectId, runId, result.skill, JSON.stringify(result), uid]);
      response = { ...result, report_id: r.rows[0].id };
    }
    await q.query("UPDATE llm_runs SET status='succeeded',input_tokens=$2,output_tokens=$3,duration_ms=$4 WHERE id=$1", [runId, usage.input_tokens, usage.output_tokens, usage.duration]);
    signal.throwIfAborted();
    return response;
  });
}
