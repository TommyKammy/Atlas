import { badRequest } from "../api/errors";
import type {
  PlanningInitiativeKind,
  PlanningMonth,
  PlanningProposalStatus,
  PlanningQuarter,
} from "./types";
import { PLANNING_QUARTERS } from "./types";
import { parsePeriodKey } from "./format";

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision <= 0) {
    throw badRequest("版番号が正しくありません");
  }
  return revision;
}

export function parsePositiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`${label}が正しくありません`);
  return id;
}

export function parseNullablePositiveId(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return parsePositiveId(value, label);
}

export function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw badRequest(`${label}が正しくありません`);
  return value;
}

export function parseYear(value: unknown): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest("年は2000〜2100の整数で指定してください");
  }
  return year;
}

export function parseQuarter(value: unknown): PlanningQuarter {
  const quarter = Number(value);
  if (!PLANNING_QUARTERS.includes(quarter as PlanningQuarter)) {
    throw badRequest("四半期は1〜4で指定してください");
  }
  return quarter as PlanningQuarter;
}

export function parsePeriodKeyInput(value: string | null): { year: number; quarter: PlanningQuarter } | null {
  if (value === null || value.trim() === "") return null;
  const parsed = parsePeriodKey(value);
  if (!parsed) throw badRequest("対象四半期の指定が正しくありません");
  return parsed;
}

export function parseSlot(value: unknown): 0 | 1 {
  const slot = Number(value);
  if (slot !== 0 && slot !== 1) throw badRequest("案はA案またはB案を指定してください");
  return slot;
}

export function parseMonthIndex(value: unknown): PlanningMonth {
  const month = Number(value);
  if (month !== 1 && month !== 2 && month !== 3) {
    throw badRequest("月は対象四半期の1〜3で指定してください");
  }
  return month;
}

export function parseBudgetYen(value: unknown): number {
  const yen = Number(value);
  if (!Number.isSafeInteger(yen) || yen < 0 || yen > 1_000_000_000_000_000) {
    throw badRequest("予算は0以上の整数円で指定してください");
  }
  return yen;
}

export function parseNullableCostYen(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const yen = Number(value);
  if (!Number.isSafeInteger(yen) || yen < 0 || yen > 1_000_000_000_000_000) {
    throw badRequest("費用は0以上の整数円、または未設定で指定してください");
  }
  return yen;
}

/**
 * Validate a nullable demand value. null means unestimated; 0 is an explicit
 * zero. Internally keep one decimal place exactly via integer tenths.
 */
export function parseNullableDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0 || days > 9999) {
    throw badRequest("人日は0以上9999以下で指定してください");
  }
  const tenths = Math.round(days * 10);
  if (Math.abs(days * 10 - tenths) > 1e-9) {
    throw badRequest("人日は0.1刻みで指定してください");
  }
  return tenths / 10;
}

/** New initiatives must name exactly one active member; free text is not accepted. */
export function parseOwnerMemberId(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    throw badRequest("起案責任者を選択してください");
  }
  return parseOwnerMemberIdValue(value);
}

/** Updates may retain a legacy free-text owner by omitting the member id. */
export function parseNullableOwnerMemberId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return parseOwnerMemberIdValue(value);
}

function parseOwnerMemberIdValue(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? value.trim() : null;
  if (raw === null || (typeof raw === "string" && !/^\d+$/.test(raw))) {
    throw badRequest("起案責任者が正しくありません");
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw badRequest("起案責任者が正しくありません");
  }
  return id;
}

/**
 * Optional legacy name echoed by the edit dialog. The server only accepts it
 * when it is identical to the stored legacy value; it never derives or guesses
 * a member from this text.
 */
export function parseOwnerNameHint(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest("起案責任者の入力内容が正しくありません");
  const name = value.trim();
  if (name.length > 120) throw badRequest("起案責任者は120文字以内で入力してください");
  return name;
}

export function parseName(value: unknown, label: string, maxLength: number): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw badRequest(`${label}を入力してください`);
  if (name.length > maxLength) throw badRequest(`${label}は${maxLength}文字以内で入力してください`);
  return name;
}

export function parseOptionalText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) throw badRequest(`${maxLength}文字以内で入力してください`);
  return text;
}

export function parseInitiativeKind(value: unknown): PlanningInitiativeKind {
  if (value !== "fixed" && value !== "candidate") {
    throw badRequest("案件の扱いは「全案に固定」または「比較候補」で指定してください");
  }
  return value;
}

export function parseReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason === "") throw badRequest("採用理由を入力してください");
  if (reason.length > 1000) throw badRequest("採用理由は1000文字以内で入力してください");
  return reason;
}

export function parseRequestId(value: unknown): string {
  const requestId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(requestId)) {
    throw badRequest("リクエストIDが正しくありません");
  }
  return requestId;
}

export type ParsedProposalReviewAction = "pass" | "return";

export function parseProposalReviewAction(value: unknown): ParsedProposalReviewAction {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (action === "pass" || action === "passed" || action === "approve" || action === "confirm") {
    return "pass";
  }
  if (
    action === "return" ||
    action === "returned" ||
    action === "request_changes" ||
    action === "send_back"
  ) {
    return "return";
  }
  throw badRequest("レビューの操作が正しくありません");
}

export function parseProposalReviewNote(value: unknown): string {
  const note = typeof value === "string" ? value.trim() : "";
  if (note === "") throw badRequest("レビューのコメント・差し戻し理由を入力してください");
  if (note.length > 2000) throw badRequest("レビューのコメントは2000文字以内で入力してください");
  return note;
}

export function parseExpectedProposalStatus(value: unknown): PlanningProposalStatus | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw badRequest("提案の想定状態が正しくありません");
  return value.trim() as PlanningProposalStatus;
}

export function parseIdList(value: unknown): number[] {
  if (!Array.isArray(value)) throw badRequest("案件の選択内容が正しくありません");
  const ids = value.map((item) => parsePositiveId(item, "案件ID"));
  return [...new Set(ids)];
}

export type ParsedDemandInput = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number | null;
};

export function parseDemandInputs(value: unknown): ParsedDemandInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("需要の入力内容が正しくありません");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isObject(item)) throw badRequest("需要の入力内容が正しくありません");
    const roleId = parsePositiveId(item.roleId, "職種ID");
    const monthIndex = parseMonthIndex(item.monthIndex);
    const key = `${roleId}:${monthIndex}`;
    if (seen.has(key)) throw badRequest("同じ職種・月の需要が重複しています");
    seen.add(key);
    return { roleId, monthIndex, days: parseNullableDays(item.days) };
  });
}

export function parseOptionalProjectId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return parsePositiveId(value, "元プロジェクトID");
}

export type ParsedCapacityInput = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number | null;
};

export function parseCapacityInputs(value: unknown): ParsedCapacityInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("配賦枠の入力内容が正しくありません");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isObject(item)) throw badRequest("配賦枠の入力内容が正しくありません");
    const roleId = parsePositiveId(item.roleId, "職種ID");
    const monthIndex = parseMonthIndex(item.monthIndex);
    const key = `${roleId}:${monthIndex}`;
    if (seen.has(key)) throw badRequest("同じ職種・月の配賦枠が重複しています");
    seen.add(key);
    return { roleId, monthIndex, days: parseNullableDays(item.days) };
  });
}

export type ParsedRoleEdit = {
  id: number | null;
  name: string;
};

export function parseRoleEdits(value: unknown): ParsedRoleEdit[] {
  if (!Array.isArray(value)) throw badRequest("職種の入力内容が正しくありません");
  if (value.length > 30) throw badRequest("職種は30件以内で登録してください");
  const names = new Set<string>();
  const ids = new Set<number>();
  return value.map((item) => {
    if (!isObject(item)) throw badRequest("職種の入力内容が正しくありません");
    const name = parseName(item.name, "職種名", 60);
    const nameKey = name.toLocaleLowerCase("ja-JP");
    if (names.has(nameKey)) throw badRequest("同じ名前の職種が重複しています");
    names.add(nameKey);
    const id = item.id === null || item.id === undefined ? null : parsePositiveId(item.id, "職種ID");
    if (id !== null) {
      if (ids.has(id)) throw badRequest("同じ職種が重複しています");
      ids.add(id);
    }
    return { id, name };
  });
}

export function parseRoleNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("職種の入力内容が正しくありません");
  if (value.length > 30) throw badRequest("職種は30件以内で登録してください");
  const seen = new Set<string>();
  return value.map((item) => {
    const name = parseName(item, "職種名", 60);
    const key = name.toLocaleLowerCase("ja-JP");
    if (seen.has(key)) throw badRequest("同じ名前の職種が重複しています");
    seen.add(key);
    return name;
  });
}
