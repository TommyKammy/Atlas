import { persistPartnerResult } from "./partner-reports";
import { createHash } from "node:crypto";
import { db } from "../db";
import { ApiError, badRequest, conflict, forbidden } from "../api/errors";
import { readPartnerSnapshot } from "./authorized-data";
import { allowed, assignedConfig, config, reserveLlmRun } from "./knowledge-ai";
import { decryptLlmKey, llmKeyReady } from "../llm-security";
import { completeLlm } from "../llm-provider";
import { partnerSkills, partnerInstruction, parsePartnerOutput, preparePartnerContext, type PartnerSkill, type PartnerResponse } from "../project-partner";

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function generateProjectPartner(projectId: number, uid: number, value: unknown, signal: AbortSignal): Promise<PartnerResponse> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("入力の形式が無効です");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["skill", "request_id", "note_id", "expected_revision"].includes(key))) throw badRequest("許可されていない入力です");
  if (typeof v.skill !== "string" || !Object.hasOwn(partnerSkills, v.skill)) throw badRequest("スキルを選択してください");
  if (typeof v.request_id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.request_id)) throw badRequest("実行IDが無効です");
  const skill = v.skill as PartnerSkill;
  if (skill === "action_extract" && (!Number.isSafeInteger(v.note_id) || Number(v.note_id) <= 0 || !Number.isSafeInteger(v.expected_revision) || Number(v.expected_revision) < 0)) throw badRequest("対象ノートを選択してください");
  if (skill !== "action_extract" && (v.note_id !== undefined || v.expected_revision !== undefined)) throw badRequest("プロジェクト全体のスキルにノートは指定できません");
  const at = new Date().toISOString(), noteId = skill === "action_extract" ? Number(v.note_id) : undefined;
  const snapshot = await readPartnerSnapshot(projectId, { userId: uid }, at, noteId);
  if (snapshot.note && snapshot.note.revision !== v.expected_revision) throw conflict("ノートが更新されています。開き直してください");
  const c = await assignedConfig(projectId);
  if (!c) throw forbidden("このプロジェクトのAI接続が管理者によって指定されていません");
  allowed(c, projectId);
  if (!llmKeyReady()) throw new ApiError(503, "LLM専用の暗号化キーが設定されていません");
  const context = preparePartnerContext(snapshot, skill, at, c.max_input_chars), before = fingerprint(snapshot);
  const key = decryptLlmKey(c.key_cipher, c.id);
  signal.throwIfAborted();
  await reserveLlmRun(c, uid, projectId, v.request_id, skill, noteId ?? null, snapshot.note?.revision ?? 0);
  const started = Date.now();
  try {
    const recheck = async () => {
      const current = await config(c.id); allowed(current, projectId);
      if (current.revision !== c.revision) throw conflict("AI接続設定が更新されました。もう一度生成してください");
      const latest = await readPartnerSnapshot(projectId, { userId: uid }, at, noteId);
      if (fingerprint(latest) !== before) throw conflict("参照データが更新されたため結果を破棄しました。もう一度生成してください");
    };
    await recheck();
    const generated = await completeLlm(c, key, partnerInstruction(skill), context.input, signal);
    signal.throwIfAborted();
    await recheck();
    const result = parsePartnerOutput(generated.text, context, skill);
    return await persistPartnerResult(projectId, uid, v.request_id, {
      ...result, skill, checked_at: context.checked_at, period_start: context.period_start, sources: context.sources, coverage: context.coverage, facts: context.facts,
    }, { noteId, revision: snapshot.note?.revision }, { input_tokens: generated.input_tokens, output_tokens: generated.output_tokens, duration: Date.now() - started }, signal);
  } catch (error) {
    await db.query("UPDATE llm_runs SET status=$2,duration_ms=$3 WHERE id=$1", [v.request_id, signal.aborted ? "cancelled" : "failed", Date.now() - started]);
    if (signal.aborted) throw new ApiError(408, "生成を中止しました");
    throw error;
  }
}
