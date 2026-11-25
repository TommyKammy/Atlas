import type { PartnerResponse, PartnerSkill } from "./project-partner";

export type ApprovalSelection = { index: number; title: string; assignee_id: number; due_on: string; section_id: number | null };
export type ApprovedAction = ApprovalSelection & { task_id: number | null };
export type ActionSuggestion = { assignee_id: number | null; due_on: string | null; section_id: number | null; date_reason: string; section_reason: string };
export type ActionOptions = { project_name: string; members: { id: number; name: string }[]; sections: { id: number; name: string }[]; approved: ApprovedAction[]; suggestions: ActionSuggestion[] };
export type PartnerReportSummary = {
  id: number; skill: Exclude<PartnerSkill, "action_extract">; summary: string; created_at: string;
  creator_name: string | null; reviewer_name: string | null; reviewed_at: string | null;
  checked_at: string; period_start: string;
};
export type PartnerReportDetail = { report: PartnerReportSummary; result: PartnerResponse };

/** Strict validation for the concrete date that is submitted for approval. */
export function explicitActionDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return "";
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : "";
}
export function matchActionAssignee(name: string | null, members: ActionOptions["members"]): string {
  if (!name) return "";
  const normalized = (v: string) => v.normalize("NFKC").trim().replace(/(?:さん|さま|様|氏|君)$/u, "").replace(/\s+/g, "").toLocaleLowerCase("ja");
  const target = normalized(name);
  if (!target) return "";
  const exact = members.filter(m => normalized(m.name) === target);
  if (exact.length) return exact.length === 1 ? String(exact[0].id) : "";
  // A Japanese family name is usable only when exactly one current member matches.
  const matches = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}$/u.test(target)
    ? members.filter(m => normalized(m.name).startsWith(target)) : [];
  return matches.length === 1 ? String(matches[0].id) : "";
}

/** Calendar suggestions are stable across reloads and use the extraction day in Japan. */
export function suggestActionDate(value: string | null, referenceAt: string): { date: string; reason: string } {
  const empty = { date: "", reason: "" };
  if (!value) return empty;
  const raw = value.normalize("NFKC").trim().replace(/\s+/g, "").replace(/(?:までに|まで|迄に|迄)$/u, "");
  const exact = explicitActionDate(raw);
  if (exact) return { date: exact, reason: "" };
  const instant = new Date(referenceAt);
  if (!Number.isFinite(instant.getTime())) return empty;
  const today = new Date(instant.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const base = new Date(`${today}T00:00:00Z`), year = base.getUTCFullYear();
  const calendar = (y: number, m: number, d: number) => explicitActionDate(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const reason = `抽出日 ${today}（日本時間）を基準に「${value}」を日付に変換しています。`;
  const absolute = raw.match(/^(\d{4})(?:年|\/)(\d{1,2})(?:月|\/)(\d{1,2})日?$/u);
  if (absolute) return { date: calendar(+absolute[1], +absolute[2], +absolute[3]), reason: "" };
  const partial = raw.match(/^(\d{1,2})(?:月|\/)(\d{1,2})日?$/u);
  if (partial) {
    const month = Number(partial[1]), day = Number(partial[2]);
    const thisYear = calendar(year, month, day);
    if (!thisYear) return empty;
    const date = thisYear < today ? calendar(year + 1, month, day) : thisYear;
    return date ? { date, reason: `${reason} 年の指定がないため、次に来る日付を提案しています。` } : empty;
  }
  let offset: number | undefined = ({ 今日: 0, 本日: 0, 明日: 1, あす: 1, 明後日: 2, あさって: 2 } as Record<string, number>)[raw];
  const days = raw.match(/^(\d{1,3})日後$/u);
  if (days) offset = +days[1];
  const weekday = raw.match(/^(今週|来週|再来週)?(?:の)?([月火水木金土日])(?:曜日|曜)?$/u);
  if (weekday) {
    const target = "日月火水木金土".indexOf(weekday[2]), current = base.getUTCDay();
    const weeks: Record<string, number> = { 今週: 0, 来週: 1, 再来週: 2 };
    offset = weekday[1] ? -((current + 6) % 7) + ((target + 6) % 7) + 7 * weeks[weekday[1]] : (target - current + 7) % 7;
  }
  if (offset === undefined) return empty;
  base.setUTCDate(base.getUTCDate() + offset);
  const date = explicitActionDate(base.toISOString().slice(0, 10));
  return date ? { date, reason: `${reason}${weekday && !weekday[1] ? " 曜日だけの指定は、当日を含む次の該当日です。" : ""}` } : empty;
}

export function suggestActionFields(action: PartnerResponse["actions"][number], members: ActionOptions["members"], sections: ActionOptions["sections"], referenceAt: string): ActionSuggestion {
  const date = suggestActionDate(action.due, referenceAt), assignee = matchActionAssignee(action.assignee, members);
  const normalize = (v: string) => v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const evidence = normalize(action.evidence);
  const named = sections.filter(s => { const name = normalize(s.name); return name && [name + "のセクション", name + "セクション", `「${name}」のセクション`, `「${name}」セクション`].some(v => evidence.includes(v)); });
  let section = named.length === 1 ? named[0] : sections.find(s => s.id === action.section_id);
  let sectionReason = named.length === 1 ? "ノートに追加先のセクションが明記されています。" : section ? action.section_reason ?? "内容に合う追加先として提案しています。" : "";
  if (!section) {
    const text = normalize(`${action.title} ${action.evidence}`);
    const matches = sections.filter(s => normalize(s.name).length >= 2 && text.includes(normalize(s.name)));
    if (matches.length === 1) { section = matches[0]; sectionReason = `候補に「${section.name}」の記載があります。`; }
    else if (!matches.length) {
      const pending = sections.filter(s => /^(未着手|未対応|やること|todo|to-do|バックログ|backlog)$/iu.test(normalize(s.name)));
      if (pending.length === 1) { section = pending[0]; sectionReason = "これから着手する仕事の追加先として提案しています。"; }
    }
  }
  return { assignee_id: assignee ? Number(assignee) : null, due_on: date.date || null, section_id: section?.id ?? null, date_reason: date.reason, section_reason: sectionReason };
}
