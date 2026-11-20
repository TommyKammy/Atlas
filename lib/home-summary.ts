import { shiftDay } from "./calendar";
import type { HomeTask } from "./home-widgets";

/** The home agenda shows a few rows per group; the rest are one link away. */
export const HOME_AGENDA_GROUP_LIMIT = 5;

export type HomeDueGroupKey = "overdue" | "today" | "week";

export const HOME_DUE_GROUP_LABELS: Record<HomeDueGroupKey, string> = {
  overdue: "期限超過",
  today: "今日",
  week: "今週",
};

const HOME_DUE_GROUP_ORDER: HomeDueGroupKey[] = ["overdue", "today", "week"];

type HomeDueTask = Pick<HomeTask, "completed" | "due_on">;

/**
 * Bucket one assigned, parent task by its due date. Completed and undated
 * tasks are not part of the home agenda. The week runs from tomorrow through
 * today + 6 days, matching the summary wording.
 */
export function homeDueGroupKey(task: HomeDueTask, today: string): HomeDueGroupKey | null {
  if (task.completed || task.due_on === null) return null;
  if (task.due_on < today) return "overdue";
  if (task.due_on === today) return "today";
  if (task.due_on <= shiftDay(today, 6)) return "week";
  return null;
}

export type HomeDueGroup<T extends HomeDueTask = HomeTask> = {
  key: HomeDueGroupKey;
  label: string;
  tasks: T[];
};

export function homeDueGroups<T extends HomeDueTask>(
  tasks: readonly T[],
  today: string,
): HomeDueGroup<T>[] {
  const buckets: Record<HomeDueGroupKey, T[]> = { overdue: [], today: [], week: [] };
  for (const task of tasks) {
    const key = homeDueGroupKey(task, today);
    if (key !== null) buckets[key].push(task);
  }
  return HOME_DUE_GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: HOME_DUE_GROUP_LABELS[key],
    tasks: buckets[key],
  }));
}

export type HomeDueSummary = {
  overdue: number;
  today: number;
  week: number;
  total: number;
};

export function homeDueSummary(tasks: readonly HomeDueTask[], today: string): HomeDueSummary {
  const summary: HomeDueSummary = { overdue: 0, today: 0, week: 0, total: 0 };
  for (const task of tasks) {
    const key = homeDueGroupKey(task, today);
    if (key === null) continue;
    summary[key] += 1;
    summary.total += 1;
  }
  return summary;
}

/** "期限超過 1件 ・ 今日が期日 1件 ・ 今週 2件", omitting zero parts. */
export function homeDueSummaryText(summary: HomeDueSummary): string {
  const parts: string[] = [];
  if (summary.overdue > 0) parts.push(`期限超過 ${summary.overdue}件`);
  if (summary.today > 0) parts.push(`今日が期日 ${summary.today}件`);
  if (summary.week > 0) parts.push(`今週 ${summary.week}件`);
  return parts.join(" ・ ");
}

/** Parent-task completion as a whole percentage; null when there is no task. */
export function homeProjectProgressPercent(total: number, done: number): number | null {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** "38% ・ 超過 1件" or "タスクなし" when the project has no parent task. */
export function homeProjectProgressText(total: number, done: number, overdue: number): string {
  const percent = homeProjectProgressPercent(total, done);
  if (percent === null) return "タスクなし";
  return overdue > 0 ? `${percent}% ・ 超過 ${overdue}件` : `${percent}%`;
}

const MONEY = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

/** Exact yen to the 万円 wording used by the planning screens. */
export function formatBudgetYen(yen: number): string {
  return `${MONEY.format(yen / 10_000)}万円`;
}

function isoMonthDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return iso;
  return `${month}月${day}日`;
}

/** Short due label: "今日" for the current day, otherwise "11月19日". */
export function homeDueDateLabel(dueOn: string | null, today: string): string {
  if (dueOn === null) return "–";
  return dueOn === today ? "今日" : isoMonthDay(dueOn);
}

const JST_DATE = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
});

/** Applicant date on the decision card: "11月16日". */
export function formatProposalSubmittedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return JST_DATE.format(date);
}

/**
 * Relative notification time in minutes, hours, days or years. The caller
 * passes `now` so server rendering and tests use one clock.
 */
export function formatRelativeTime(iso: string, now: string): string {
  const date = new Date(iso);
  const current = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) return "";
  const diff = current.getTime() - date.getTime();
  if (diff < 60_000) return "たった今";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}日前`;
  return `${Math.floor(days / 365)}年前`;
}
