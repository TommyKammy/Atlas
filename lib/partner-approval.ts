import { badRequest } from "./api/errors";
import { explicitActionDate, type ApprovalSelection } from "./partner-workflows";

export function validateApproval(value: unknown): { batch_id: string; actions: ApprovalSelection[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("承認内容が無効です");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["batch_id", "confirmed", "actions"].includes(k)) || v.confirmed !== true) throw badRequest("内容を確認してから承認してください");
  if (typeof v.batch_id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.batch_id)) throw badRequest("候補IDが無効です");
  if (!Array.isArray(v.actions) || !v.actions.length || v.actions.length > 15) throw badRequest("追加する候補を選択してください");
  const actions = v.actions.map((item): ApprovalSelection => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw badRequest("候補が無効です");
    const a = item as Record<string, unknown>;
    if (Object.keys(a).some(k => !["index", "title", "assignee_id", "due_on", "section_id"].includes(k))) throw badRequest("許可されていない項目です");
    if (!Number.isSafeInteger(a.index) || Number(a.index) < 0 || Number(a.index) >= 15) throw badRequest("候補が無効です");
    if (typeof a.title !== "string" || !a.title.trim() || a.title.length > 300) throw badRequest("タスク名は1〜300文字で入力してください");
    if (!Number.isSafeInteger(a.assignee_id) || Number(a.assignee_id) <= 0) throw badRequest("担当者を選択してください");
    const due = explicitActionDate(a.due_on); if (!due) throw badRequest("期限を具体的な日付で指定してください");
    if (a.section_id !== null && (!Number.isSafeInteger(a.section_id) || Number(a.section_id) <= 0)) throw badRequest("セクションが無効です");
    return { index: Number(a.index), title: a.title.trim(), assignee_id: Number(a.assignee_id), due_on: due, section_id: a.section_id === null ? null : Number(a.section_id) };
  });
  if (new Set(actions.map(a => a.index)).size !== actions.length) throw badRequest("同じ候補が重複しています");
  return { batch_id: v.batch_id, actions };
}
