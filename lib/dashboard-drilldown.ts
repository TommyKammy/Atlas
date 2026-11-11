import { todayISO } from "./dates";
import { isMultiSeriesChart, isTimeChart } from "./dashboard-types";
import type {
  DashboardChartType,
  DashboardDrilldown,
  DashboardDrilldownCategory,
  DashboardDrilldownSeries,
  DashboardFilter,
  DashboardGroupBy,
  DashboardMetric,
  DashboardTask,
} from "./dashboard-types";

export type { DashboardDrilldown, DashboardDrilldownCategory } from "./dashboard-types";

export const DASHBOARD_DRILLDOWN_MAX_LENGTH = 4096;
const MAX_TITLE_LENGTH = 360;
const MAX_STATUS_LENGTH = 200;
const CHART_TYPES = new Set<DashboardChartType>([
  "bar", "stacked_bar", "grouped_bar", "line", "burnup", "burndown", "donut", "number", "lollipop",
]);
const GROUPS = new Set<DashboardGroupBy>([
  "section", "assignee", "status", "completion", "due_month", "created_month",
]);
const METRICS = new Set<DashboardMetric>([
  "count", "completed", "incomplete", "overdue", "progress_avg", "progress_sum",
]);
const SERIES = new Set<DashboardDrilldownSeries>(["all", "open", "done", "total", "remaining"]);

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  if (dt.getUTCFullYear() < 1) return "0001-01-01";
  if (dt.getUTCFullYear() > 9999) return "9999-12-31";
  return dt.toISOString().slice(0, 10);
}

/** Shared by chart computation and drilldown selection, including exact endpoints. */
function dashboardFilterPredicate(filters: DashboardFilter, today: string): (task: DashboardTask) => boolean {
  const completion = filters.completion ?? "all";
  const weekEnd = addDaysISO(today, 7);
  const monthEnd = addDaysISO(today, 30);
  return (task) => {
    if (completion === "open" && task.completed) return false;
    if (completion === "done" && !task.completed) return false;
    if (filters.assignee === "none" && task.assignee_id !== null) return false;
    if (typeof filters.assignee === "number" && task.assignee_id !== filters.assignee) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (typeof filters.section === "number" && task.section_id !== filters.section) return false;
    if (filters.due === "overdue" && (task.completed || !task.due_on || task.due_on >= today)) return false;
    if (filters.due === "today" && task.due_on !== today) return false;
    if (filters.due === "week" && (!task.due_on || task.due_on < today || task.due_on > weekEnd)) return false;
    if (filters.due === "month" && (!task.due_on || task.due_on < today || task.due_on > monthEnd)) return false;
    return true;
  };
}

export function filterDashboardTasks(
  tasks: DashboardTask[],
  filters: DashboardFilter,
  today = todayISO(),
): DashboardTask[] {
  return tasks.filter(dashboardFilterPredicate(filters, today));
}

function contributesToMetric(task: DashboardTask, metric: DashboardMetric, today: string): boolean {
  if (metric === "completed") return task.completed;
  if (metric === "incomplete") return !task.completed;
  if (metric === "overdue") return !task.completed && task.due_on !== null && task.due_on < today;
  return true;
}

export function metricValue(tasks: DashboardTask[], metric: DashboardMetric, today = todayISO()): number {
  if (metric === "progress_sum" || metric === "progress_avg") {
    const sum = tasks.reduce((total, task) => total + (Number(task.progress) || 0), 0);
    return metric === "progress_sum" ? sum : tasks.length === 0 ? 0 : Math.round(sum / tasks.length);
  }
  return tasks.reduce((count, task) => count + Number(contributesToMetric(task, metric, today)), 0);
}

function inCategory(task: DashboardTask, category: DashboardDrilldownCategory): boolean {
  switch (category.kind) {
    case "section": return task.section_id === category.id;
    case "assignee": return task.assignee_id === category.id;
    case "status": return task.status === category.value;
    case "completion": return task.completed === category.completed;
    case "due_month": return category.month === null ? task.due_on === null : task.due_on?.slice(0, 7) === category.month;
    case "created_month": return task.created_on.slice(0, 7) === category.month;
    case "day": return true; // Time-series membership is evaluated below.
  }
}

/** Re-evaluate a condition snapshot against the caller's authorized project tasks. */
export function selectDashboardDrilldownTasks(
  tasks: DashboardTask[],
  drilldown: DashboardDrilldown,
): DashboardTask[] {
  const matchesFilter = dashboardFilterPredicate(drilldown.filters, drilldown.asOfDay);
  const category = drilldown.category;
  const series = drilldown.seriesKey ?? "all";
  const timeChart = isTimeChart(drilldown.chartType);
  const multiSeries = isMultiSeriesChart(drilldown.chartType);
  return tasks.filter((task) => {
    if (!matchesFilter(task)) return false;
    if (timeChart) {
      if (!category || category.kind !== "day") return true;
      const day = category.day;
      if (series === "done") return task.completed_on !== null && task.completed_on <= day;
      if (series === "remaining") return task.created_on <= day && (task.completed_on === null || task.completed_on > day);
      return task.created_on <= day;
    }
    if (category && !inCategory(task, category)) return false;
    if (multiSeries) {
      return series === "open" ? !task.completed : series === "done" ? task.completed : true;
    }
    return contributesToMetric(task, drilldown.metric, drilldown.asOfDay);
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function strictDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function strictMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith("0000");
}

function parseFilters(value: unknown): DashboardFilter | null {
  if (!record(value) || !onlyKeys(value, ["completion", "assignee", "status", "due", "section"])) return null;
  const filters: DashboardFilter = {};
  if (value.completion !== undefined) {
    if (value.completion !== "all" && value.completion !== "open" && value.completion !== "done") return null;
    filters.completion = value.completion;
  }
  if (value.assignee !== undefined) {
    if (value.assignee !== "none" && value.assignee !== "" && !positiveId(value.assignee)) return null;
    filters.assignee = value.assignee;
  }
  if (value.status !== undefined) {
    if (typeof value.status !== "string" || value.status.length > MAX_STATUS_LENGTH) return null;
    filters.status = value.status;
  }
  if (value.due !== undefined) {
    if (!["", "overdue", "today", "week", "month"].includes(value.due as string)) return null;
    filters.due = value.due as DashboardFilter["due"];
  }
  if (value.section !== undefined) {
    if (value.section !== "" && !positiveId(value.section)) return null;
    filters.section = value.section;
  }
  return filters;
}

function parseCategory(value: unknown): DashboardDrilldownCategory | null {
  if (!record(value)) return null;
  if (value.kind === "section" || value.kind === "assignee") {
    if (!onlyKeys(value, ["kind", "id"]) || (value.id !== null && !positiveId(value.id))) return null;
    return { kind: value.kind, id: value.id };
  }
  if (value.kind === "status") {
    return onlyKeys(value, ["kind", "value"]) && typeof value.value === "string" && value.value.length <= MAX_STATUS_LENGTH
      ? { kind: "status", value: value.value } : null;
  }
  if (value.kind === "completion") {
    return onlyKeys(value, ["kind", "completed"]) && typeof value.completed === "boolean"
      ? { kind: "completion", completed: value.completed } : null;
  }
  if (value.kind === "due_month") {
    return onlyKeys(value, ["kind", "month"]) && (value.month === null || strictMonth(value.month))
      ? { kind: "due_month", month: value.month } : null;
  }
  if (value.kind === "created_month") {
    return onlyKeys(value, ["kind", "month"]) && strictMonth(value.month)
      ? { kind: "created_month", month: value.month } : null;
  }
  if (value.kind === "day") {
    return onlyKeys(value, ["kind", "day"]) && strictDay(value.day) ? { kind: "day", day: value.day } : null;
  }
  return null;
}

/** Strict, bounded URL input. Invalid conditions must never silently widen a list. */
export function parseDashboardDrilldown(raw: unknown): DashboardDrilldown | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > DASHBOARD_DRILLDOWN_MAX_LENGTH) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!record(value) || !onlyKeys(value, ["v", "title", "filters", "metric", "chartType", "groupBy", "asOfDay", "category", "seriesKey"])) return null;
  if (value.v !== 1 || typeof value.title !== "string" || !value.title.trim() || value.title.length > MAX_TITLE_LENGTH || !strictDay(value.asOfDay)) return null;
  if (!METRICS.has(value.metric as DashboardMetric) || !CHART_TYPES.has(value.chartType as DashboardChartType) || !GROUPS.has(value.groupBy as DashboardGroupBy)) return null;
  const filters = parseFilters(value.filters);
  if (filters === null) return null;
  const category = value.category === undefined ? undefined : parseCategory(value.category);
  if (category === null) return null;
  const seriesKey = value.seriesKey === undefined ? "all" : value.seriesKey;
  if (!SERIES.has(seriesKey as DashboardDrilldownSeries)) return null;
  const chartType = value.chartType as DashboardChartType;
  if (isTimeChart(chartType)) {
    if (category) {
      if (category.kind !== "day" || category.day > value.asOfDay) return null;
      if (chartType === "burndown" ? seriesKey !== "remaining" : seriesKey !== "total" && seriesKey !== "done") return null;
    } else if (seriesKey !== "all") return null;
  } else {
    if (category && (category.kind !== value.groupBy || chartType === "number")) return null;
    if (isMultiSeriesChart(chartType) ? seriesKey !== "all" && seriesKey !== "open" && seriesKey !== "done" : seriesKey !== "all") return null;
  }
  return {
    v: 1, title: value.title, filters, metric: value.metric as DashboardMetric,
    chartType, groupBy: value.groupBy as DashboardGroupBy, asOfDay: value.asOfDay,
    ...(category ? { category } : {}), seriesKey: seriesKey as DashboardDrilldownSeries,
  };
}

export function dashboardDrilldownHref(projectId: number, drilldown: DashboardDrilldown): string {
  if (!positiveId(projectId)) throw new Error("A positive project ID is required");
  const params = new URLSearchParams({ view: "list", dashboard: JSON.stringify(drilldown) });
  return `/projects/${projectId}?${params.toString()}`;
}
