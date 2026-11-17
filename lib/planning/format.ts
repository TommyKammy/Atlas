import type { PlanningMonth, PlanningQuarter } from "./types";

export function quarterStartMonth(quarter: PlanningQuarter): number {
  return (quarter - 1) * 3 + 1;
}

export function quarterMonths(quarter: PlanningQuarter): [number, number, number] {
  const start = quarterStartMonth(quarter);
  return [start, start + 1, start + 2];
}

export function monthLabel(quarter: PlanningQuarter, monthIndex: PlanningMonth): string {
  return `${quarterMonths(quarter)[monthIndex - 1]}月`;
}

export function monthNumber(startMonth: number, monthIndex: PlanningMonth): number {
  return startMonth + monthIndex - 1;
}

export function monthLabelFromStart(startMonth: number, monthIndex: PlanningMonth): string {
  return `${monthNumber(startMonth, monthIndex)}月`;
}

export function periodLabel(year: number, quarter: PlanningQuarter): string {
  const months = quarterMonths(quarter);
  return `${year}年 ${months[0]}月–${months[2]}月`;
}

export function periodKey(year: number, quarter: PlanningQuarter): string {
  return `${year}-Q${quarter}`;
}

export function parsePeriodKey(value: string | null | undefined): { year: number; quarter: PlanningQuarter } | null {
  if (!value) return null;
  const match = /^(\d{4})-Q([1-4])$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]) as PlanningQuarter;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return { year, quarter };
}

export function formatManYen(yen: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(yen / 10_000);
}

export function formatDays(days: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(days);
}

/** Convert an exact yen amount into a plain 万円 input value (no grouping). */
export function yenToManYenInput(yen: number): string {
  const value = yen / 10_000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export type ParsedAmount =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Parse 万円 to integer yen. Blank means unestimated (null), not zero. */
export function parseManYenInput(raw: string): ParsedAmount {
  const text = raw.replace(/,/g, "").trim();
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "万円は小数2桁までの0以上の数値で入力してください" };
  }
  const value = Number(text);
  const yen = Math.round(value * 10_000);
  if (!Number.isSafeInteger(yen) || yen > 1_000_000_000_000_000) {
    return { ok: false, error: "金額が大きすぎます" };
  }
  return { ok: true, value: yen };
}

/** Parse 人日 in 0.1-day increments. Blank means unestimated (null), not zero. */
export function parseDaysInput(raw: string): ParsedAmount {
  const text = raw.replace(/,/g, "").trim();
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(?:\.\d)?$/.test(text)) {
    return { ok: false, error: "人日は小数1桁までの0以上の数値で入力してください" };
  }
  const value = Number(text);
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(value) || rounded > 9999) {
    return { ok: false, error: "人日が大きすぎます" };
  }
  return { ok: true, value: rounded };
}

export function formatDecisionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatMonthDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
