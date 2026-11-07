import { todayISO } from "./dates";
import type {
  DashboardChartType,
  DashboardFilter,
  DashboardMeta,
  DashboardMetric,
  DashboardTask,
  DashboardWidget,
  DashboardWidgetOptions,
} from "./dashboard-types";
import { isMultiSeriesChart, isTimeChart } from "./dashboard-types";

export type DashboardCategory = {
  label: string;
  values: number[];
};

export type DashboardWidgetData = {
  kind: "chart" | "number" | "text" | "disabled-status";
  categories: DashboardCategory[];
  series: string[];
  value?: number;
  matched: number;
  benchmark?: number | null;
  dataLabels: boolean;
};

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function monthLabel(day: string): string {
  const [y, m] = day.split("-");
  return `${y}/${m}`;
}

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function filterDashboardTasks(
  tasks: DashboardTask[],
  filters: DashboardFilter,
  today = todayISO(),
): DashboardTask[] {
  const completion = filters.completion ?? "all";
  const due = filters.due ?? "";
  const weekEnd = addDaysISO(today, 7);
  const monthEnd = addDaysISO(today, 30);
  return tasks.filter((task) => {
    if (completion === "open" && task.completed) return false;
    if (completion === "done" && !task.completed) return false;
    if (filters.assignee === "none" && task.assignee_id !== null) return false;
    if (typeof filters.assignee === "number" && task.assignee_id !== filters.assignee) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (typeof filters.section === "number" && task.section_id !== filters.section) return false;
    if (due === "overdue" && (task.completed || !task.due_on || task.due_on >= today)) return false;
    if (due === "today" && task.due_on !== today) return false;
    if (due === "week" && (!task.due_on || task.due_on < today || task.due_on > weekEnd)) return false;
    if (due === "month" && (!task.due_on || task.due_on < today || task.due_on > monthEnd)) return false;
    return true;
  });
}

export function metricValue(tasks: DashboardTask[], metric: DashboardMetric, today = todayISO()): number {
  switch (metric) {
    case "count":
      return tasks.length;
    case "completed":
      return tasks.filter((t) => t.completed).length;
    case "incomplete":
      return tasks.filter((t) => !t.completed).length;
    case "overdue":
      return tasks.filter((t) => !t.completed && t.due_on !== null && t.due_on < today).length;
    case "progress_avg":
      return tasks.length === 0
        ? 0
        : Math.round(tasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / tasks.length);
    case "progress_sum":
      return tasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0);
    default:
      return 0;
  }
}

export function activeFilterCount(filters: DashboardFilter): number {
  let n = 0;
  if (filters.completion && filters.completion !== "all") n += 1;
  if (filters.assignee !== undefined && filters.assignee !== "") n += 1;
  if (filters.status) n += 1;
  if (filters.due) n += 1;
  if (filters.section !== undefined && filters.section !== "") n += 1;
  return n;
}

type GroupDescriptor = { label: string; order: number };

function groupDescriptor(
  task: DashboardTask,
  groupBy: DashboardWidget["group_by"],
  meta: DashboardMeta,
): GroupDescriptor {
  if (groupBy === "section") {
    const idx = meta.sections.findIndex((s) => s.id === task.section_id);
    if (idx >= 0) return { label: meta.sections[idx].name, order: idx };
    return { label: "セクションなし", order: 100000 };
  }
  if (groupBy === "assignee") {
    if (task.assignee_id !== null) {
      const idx = meta.users.findIndex((u) => u.id === task.assignee_id);
      return { label: task.assignee_name ?? `ユーザー${task.assignee_id}`, order: idx >= 0 ? idx : 90000 };
    }
    return { label: "未割り当て", order: 100000 };
  }
  if (groupBy === "status") {
    if (!task.status) return { label: "未設定", order: 100000 };
    const idx = meta.statusOptions.indexOf(task.status);
    return { label: task.status, order: idx >= 0 ? idx : 50000 };
  }
  if (groupBy === "completion") {
    return task.completed ? { label: "完了", order: 1 } : { label: "未完了", order: 0 };
  }
  if (groupBy === "due_month") {
    if (!task.due_on) return { label: "期限なし", order: 100000 };
    return { label: monthLabel(task.due_on), order: Number(task.due_on.slice(0, 7).replace("-", "")) };
  }
  return { label: monthLabel(task.created_on), order: Number(task.created_on.slice(0, 7).replace("-", "")) };
}

function compareCategory(
  groupBy: DashboardWidget["group_by"],
  a: { label: string; order: number; total: number },
  b: { label: string; order: number; total: number },
): number {
  if (groupBy === "assignee" || groupBy === "status") {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label, "ja");
  }
  if (a.order !== b.order) return a.order - b.order;
  return a.label.localeCompare(b.label, "ja");
}

function categoricalData(
  widget: DashboardWidget,
  tasks: DashboardTask[],
  meta: DashboardMeta,
  today: string,
): DashboardWidgetData {
  const groups = new Map<
    string,
    { label: string; order: number; all: DashboardTask[]; open: DashboardTask[]; done: DashboardTask[] }
  >();
  for (const task of tasks) {
    const desc = groupDescriptor(task, widget.group_by, meta);
    const group = groups.get(desc.label) ?? {
      label: desc.label,
      order: desc.order,
      all: [],
      open: [],
      done: [],
    };
    group.all.push(task);
    if (task.completed) group.done.push(task);
    else group.open.push(task);
    groups.set(desc.label, group);
  }

  const multi = isMultiSeriesChart(widget.chart_type);
  const series = multi ? ["未完了", "完了"] : [widget.title];
  const categories = [...groups.values()]
    .sort((a, b) =>
      compareCategory(
        widget.group_by,
        { label: a.label, order: a.order, total: a.all.length },
        { label: b.label, order: b.order, total: b.all.length },
      ),
    )
    .map((group) => ({
      label: group.label,
      values: multi
        ? [group.open.length, group.done.length]
        : [metricValue(group.all, widget.metric, today)],
    }));

  return {
    kind: "chart",
    categories,
    series,
    matched: tasks.length,
    benchmark: widget.options.benchmark ?? null,
    dataLabels: widget.options.data_labels !== false,
  };
}

function timeData(widget: DashboardWidget, tasks: DashboardTask[], today: string): DashboardWidgetData {
  const requested = Number(widget.options.range_days);
  const days = [7, 14, 30, 90].includes(requested) ? requested : 30;
  const start = addDaysISO(today, -(days - 1));
  const labels: string[] = [];
  for (let i = 0; i < days; i += 1) labels.push(addDaysISO(start, i));

  const chartType: DashboardChartType = widget.chart_type;
  const cumulativeTotal = labels.map((day) => tasks.filter((t) => t.created_on <= day).length);
  const cumulativeDone = labels.map(
    (day) => tasks.filter((t) => t.completed_on !== null && t.completed_on <= day).length,
  );
  const series =
    chartType === "burndown" ? ["残り"] : ["合計", "完了"];
  const categories = labels.map((day, index) => ({
    label: dayLabel(day),
    values:
      chartType === "burndown"
        ? [Math.max(0, cumulativeTotal[index] - cumulativeDone[index])]
        : [cumulativeTotal[index], cumulativeDone[index]],
  }));

  return {
    kind: "chart",
    categories,
    series,
    matched: tasks.length,
    benchmark: widget.options.benchmark ?? null,
    dataLabels: widget.options.data_labels === true,
  };
}

export function computeDashboardWidget(
  widget: DashboardWidget,
  tasks: DashboardTask[],
  meta: DashboardMeta,
  today = todayISO(),
): DashboardWidgetData {
  if (widget.widget_type === "text") {
    return { kind: "text", categories: [], series: [], matched: 0, dataLabels: false };
  }
  if (widget.group_by === "status" && !meta.statusFieldEnabled) {
    return { kind: "disabled-status", categories: [], series: [], matched: 0, dataLabels: false };
  }

  const filtered = filterDashboardTasks(tasks, widget.filters, today);
  if (widget.chart_type === "number") {
    return {
      kind: "number",
      categories: [],
      series: [],
      value: metricValue(filtered, widget.metric, today),
      matched: filtered.length,
      dataLabels: false,
    };
  }
  if (isTimeChart(widget.chart_type)) {
    return timeData(widget, filtered, today);
  }
  return categoricalData(widget, filtered, meta, today);
}

export function widgetSummary(widget: DashboardWidget, meta: DashboardMeta): string {
  if (widget.widget_type === "text") return "テキスト";
  if (widget.chart_type === "number") return "数値";
  if (isTimeChart(widget.chart_type)) return `過去${widget.options.range_days ?? 30}日`;
  if (widget.group_by === "status" && !meta.statusFieldEnabled) return "Statusなし";
  return `${widget.title}`;
}

export function normaliseWidgetOptions(value: unknown): DashboardWidgetOptions {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const options: DashboardWidgetOptions = {};
  if (typeof raw.data_labels === "boolean") options.data_labels = raw.data_labels;
  if (typeof raw.range_days === "number") options.range_days = raw.range_days;
  if (typeof raw.benchmark === "number") options.benchmark = raw.benchmark;
  if (raw.benchmark === null) options.benchmark = null;
  return options;
}

export function normaliseWidgetFilters(value: unknown): DashboardFilter {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const filters: DashboardFilter = {};
  if (raw.completion === "all" || raw.completion === "open" || raw.completion === "done") {
    filters.completion = raw.completion;
  }
  if (raw.assignee === "none" || raw.assignee === "") filters.assignee = raw.assignee;
  else if (typeof raw.assignee === "number") filters.assignee = raw.assignee;
  if (typeof raw.status === "string") filters.status = raw.status;
  if (raw.due === "overdue" || raw.due === "today" || raw.due === "week" || raw.due === "month" || raw.due === "") {
    filters.due = raw.due;
  }
  if (raw.section === "" || typeof raw.section === "number") filters.section = raw.section;
  return filters;
}
