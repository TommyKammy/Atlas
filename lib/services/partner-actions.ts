import { createHash } from "node:crypto";
import { withTransaction, type Queryable } from "../db";
import { badRequest, conflict, notFound } from "../api/errors";
import { audit } from "../audit";
import { projectTaskReadScope } from "../repositories/scope";
import { validateApproval } from "../partner-approval";
import type { ActionOptions, ApprovalSelection, ApprovedAction } from "../partner-workflows";
import { suggestActionFields } from "../partner-workflows";
import type { PartnerAction } from "../project-partner";
import type { RichTextNode } from "../rich-text-types";
import { lockPartnerProject } from "./partner-access";
import { insertTask, afterTaskCreated } from "./task-create";

type Batch = { id: string; project_id: number; note_id: number | null; source_note_id: number; source_revision: number; created_at: string; actions: PartnerAction[] };
const keyFor = (b: Batch, a: PartnerAction) => createHash("sha256").update(JSON.stringify([b.source_note_id, b.source_revision, a.title.trim().replace(/\s+/g, " "), a.evidence.trim().replace(/\s+/g, " ")])).digest("hex");
async function batch(q: Queryable, projectId: number, uid: number, id: string): Promise<Batch> {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw badRequest("候補IDが無効です");
  const r = (await q.query("SELECT *,created_at::text AS created_at FROM partner_action_batches WHERE id=$1 AND project_id=$2 AND created_by=$3", [id, projectId, uid])).rows[0];
  if (!r) throw notFound("候補が見つからないか、承認する権限がありません");
  return r;
}
async function receipts(q: Queryable, b: Batch): Promise<ApprovedAction[]> {
  const keys = b.actions.map(a => keyFor(b, a));
  const rows = (await q.query(`SELECT a.action_key,a.selection,
      CASE WHEN t.deleted_at IS NULL AND ${projectTaskReadScope("t")} THEN t.id ELSE NULL END AS task_id
    FROM partner_action_approvals a LEFT JOIN tasks t ON t.id=a.task_id
    WHERE a.project_id=$1 AND a.action_key=ANY($2::text[])`, [b.project_id, keys])).rows;
  return b.actions.flatMap((_, index) => {
    const row = rows.find(r => r.action_key === keys[index]);
    return row ? [{ ...row.selection, index, task_id: row.task_id }] : [];
  });
}
export async function actionOptions(projectId: number, uid: number, id: string): Promise<ActionOptions> {
  // One transaction locks membership changes while collecting options; approval checks again.
  return withTransaction(async q => {
    const project = await lockPartnerProject(q, projectId, uid), b = await batch(q, projectId, uid, id);
    const members = (await q.query(`SELECT u.id,u.name FROM users u JOIN project_members m ON m.user_id=u.id
      WHERE m.project_id=$1 AND u.deactivated_at IS NULL ORDER BY u.name,u.id`, [projectId])).rows;
    const sections = (await q.query("SELECT id,name FROM sections WHERE project_id=$1 ORDER BY position,id", [projectId])).rows;
    return { project_name: project.name, members, sections, approved: await receipts(q, b), suggestions: b.actions.map(a => suggestActionFields(a, members, sections, b.created_at)) };
  });
}
const sameSelection = (a: ApprovalSelection, b: ApprovalSelection) => a.title === b.title && a.assignee_id === b.assignee_id && a.due_on === b.due_on && a.section_id === b.section_id;

export async function approvePartnerActions(projectId: number, uid: number, value: unknown) {
  const input = validateApproval(value);
  const result = await withTransaction(async q => {
    await lockPartnerProject(q, projectId, uid);
    const b = await batch(q, projectId, uid, input.batch_id);
    if (input.actions.some(a => !b.actions[a.index])) throw badRequest("候補を選び直してください");
    const approved = await receipts(q, b);
    for (const a of input.actions) {
      const existing = approved.find(item => item.index === a.index);
      if (existing && !sameSelection(a, existing)) throw conflict("この候補は既に追加済みです。作成したタスクから変更してください");
    }
    const pending = input.actions.filter(a => !approved.some(p => p.index === a.index));
    const created: { id: number; name: string }[] = [];
    if (pending.length) {
      const source = (await q.query("SELECT title,revision FROM project_knowledge WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE", [b.note_id, projectId])).rows[0];
      if (!source || source.revision !== b.source_revision) throw conflict("元ノートが更新・削除されています。開き直して再抽出してください");
      // Validate the whole selection before creating anything. Project lock also
      // serializes membership changes and duplicate approvals across regenerated batches.
      for (const a of pending) {
        const member = await q.query(`SELECT u.id FROM users u JOIN project_members m ON m.user_id=u.id
          WHERE m.project_id=$1 AND u.id=$2 AND u.deactivated_at IS NULL FOR SHARE OF u,m`, [projectId, a.assignee_id]);
        if (!member.rowCount) throw badRequest("担当者は現在のプロジェクトメンバーから選択してください");
        if (a.section_id !== null && !(await q.query("SELECT id FROM sections WHERE project_id=$1 AND id=$2 FOR SHARE", [projectId, a.section_id])).rowCount) throw badRequest("セクションを選び直してください");
      }
      for (const a of pending) {
        const original = b.actions[a.index], key = keyFor(b, original);
        const existing = (await q.query("SELECT selection FROM partner_action_approvals WHERE project_id=$1 AND action_key=$2", [projectId, key])).rows[0];
        if (existing) { if (!sameSelection(a, existing.selection)) throw conflict("同じ候補が重複しています"); continue; }
        const href = `/projects/${projectId}?view=knowledge&note=${b.note_id}`;
        const paragraph = (text: string): RichTextNode => ({ type: "paragraph", content: [{ type: "text", text }] });
        const id = await insertTask(q, { projectId, uid, sectionId: a.section_id, parentId: null, name: a.title, assigneeId: a.assignee_id,
          start: null, due: a.due_on, isMilestone: false,
          description: `プロジェクトパートナーの提案を承認して追加\n元ノート: ${source.title}\n${href}\n\n根拠:\n${original.evidence}`,
          descriptionDoc: { type: "doc", content: [paragraph("プロジェクトパートナーの提案を承認して追加"), paragraph(`元ノート: ${source.title}`),
            { type: "paragraph", content: [{ type: "text", text: "元ノートを開く", marks: [{ type: "link", attrs: { href } }] }] }, paragraph("根拠:"), paragraph(original.evidence)] } });
        await q.query(`INSERT INTO partner_action_approvals(project_id,action_key,batch_id,action_index,task_id,approved_by,selection)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [projectId,key,b.id,a.index,id,uid,JSON.stringify(a)]);
        await audit(uid, "partner.action.approve", { entity: "task", entityId: id, projectId, summary: `ノート #${b.note_id} の候補を承認: ${a.title}` }, q);
        created.push({ id, name: a.title });
      }
    }
    return { approved: await receipts(q, b), created };
  });
  // Standard creation effects run only for newly committed tasks, never on replay.
  // Durable task.created events are already committed for the automation worker.
  await Promise.allSettled(result.created.map(t => afterTaskCreated(projectId, t.id, uid, t.name)));
  return { approved: result.approved, created_count: result.created.length };
}
