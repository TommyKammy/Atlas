import { todayISO } from "./dates";
import type {
  DashboardChartType,
  DashboardDrilldown,
  DashboardDrilldownCategory,
  DashboardDrilldownSeries,
  DashboardFilter,
  DashboardMeta,
  DashboardTask,
  DashboardWidget,
  DashboardWidgetOptions,
} from "./dashboard-types";
import { isMultiSeriesChart, isTimeChart } from "./dashboard-types";
import { addDaysISO, filterDashboardTasks, metricValue, selectDashboardDrilldownTasks } from "./dashboard-drilldown";

export { addDaysISO, filterDashboardTasks, metricValue } from "./dashboard-drilldown";

export type DashboardCategory = {
  key: string;
  label: string;
  values: number[];
  drilldowns: DashboardDrilldown[];
};

export type DashboardWidgetData = {
  kind: "chart" | "number" | "text" | "disabled-status";
  categories: DashboardCategory[];
  series: string[];
  value?: number;
  matched: number;
  benchmark?: number | null;
  dataLabels: boolean;
  drilldown?: DashboardDrilldown;
};

export function monthLabel(day: string): string {
  const [y, m] = day.split("-");
  return `${y}/${m}`;
}

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
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

type GroupDescriptor = { key: string; category: DashboardDrilldownCategory; label: string; order: number };

function group(category: DashboardDrilldownCategory, label: string, order: number): GroupDescriptor {
  return { key: JSON.stringify(category), category, label, order };
}

function drilldown(
  widget: DashboardWidget,
  today: string,
  category?: DashboardDrilldownCategory,
  seriesKey: DashboardDrilldownSeries = "all",
  label?: string,
): DashboardDrilldown {
  return {
    v: 1,
    title: (label ? `${widget.title} / ${label}` : widget.title).slice(0, 360),
    filters: { ...widget.filters },
    metric: widget.metric,
    chartType: widget.chart_type,
    groupBy: widget.group_by,
    asOfDay: today,
    ...(category ? { category } : {}),
    seriesKey,
  };
}

function groupDescriptor(
  task: DashboardTask,
  groupBy: DashboardWidget["group_by"],
  meta: DashboardMeta,
): GroupDescriptor {
  if (groupBy === "section") {
    const idx = meta.sections.findIndex((s) => s.id === task.section_id);
    return group({ kind: "section", id: task.section_id }, idx >= 0 ? meta.sections[idx].name : "セクションなし", idx >= 0 ? idx : 100000);
  }
  if (groupBy === "assignee") {
    if (task.assignee_id !== null) {
      const idx = meta.users.findIndex((u) => u.id === task.assignee_id);
      return group({ kind: "assignee", id: task.assignee_id }, task.assignee_name ?? `ユーザー${task.assignee_id}`, idx >= 0 ? idx : 90000);
    }
    return group({ kind: "assignee", id: null }, "未割り当て", 100000);
  }
  if (groupBy === "status") {
    if (!task.status) return group({ kind: "status", value: "" }, "未設定", 100000);
    const idx = meta.statusOptions.indexOf(task.status);
    return group({ kind: "status", value: task.status }, task.status, idx >= 0 ? idx : 50000);
  }
  if (groupBy === "completion") {
    return group({ kind: "completion", completed: task.completed }, task.completed ? "完了" : "未完了", task.completed ? 1 : 0);
  }
  if (groupBy === "due_month") {
    if (!task.due_on) return group({ kind: "due_month", month: null }, "期限なし", 100000);
    return group({ kind: "due_month", month: task.due_on.slice(0, 7) }, monthLabel(task.due_on), Number(task.due_on.slice(0, 7).replace("-", "")));
  }
  return group({ kind: "created_month", month: task.created_on.slice(0, 7) }, monthLabel(task.created_on), Number(task.created_on.slice(0, 7).replace("-", "")));
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
    GroupDescriptor & { all: DashboardTask[] }
  >();
  for (const task of tasks) {
    const desc = groupDescriptor(task, widget.group_by, meta);
    const group = groups.get(desc.key) ?? {
      ...desc,
      all: [],
    };
    group.all.push(task);
    groups.set(desc.key, group);
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
    .map((group) => {
      const drilldowns = multi
        ? [drilldown(widget, today, group.category, "open", `${group.label} / 未完了`),
          drilldown(widget, today, group.category, "done", `${group.label} / 完了`)]
        : [drilldown(widget, today, group.category, "all", group.label)];
      return {
        key: group.key,
        label: group.label,
        values: drilldowns.map((selection) => {
          const selected = selectDashboardDrilldownTasks(group.all, selection);
          return multi ? selected.length : metricValue(selected, widget.metric, today);
        }),
        drilldowns,
      };
    });

  return {
    kind: "chart",
    categories,
    series,
    matched: tasks.length,
    benchmark: widget.options.benchmark ?? null,
    dataLabels: widget.options.data_labels !== false,
    drilldown: drilldown(widget, today),
  };
}

function timeData(widget: DashboardWidget, tasks: DashboardTask[], today: string): DashboardWidgetData {
  const requested = Number(widget.options.range_days);
  const days = [7, 14, 30, 90].includes(requested) ? requested : 30;
  const start = addDaysISO(today, -(days - 1));
  const labels: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDaysISO(start, i);
    if (day > today || labels.at(-1) === day) break;
    labels.push(day);
  }

  const chartType: DashboardChartType = widget.chart_type;
  const series =
    chartType === "burndown" ? ["残り"] : ["合計", "完了"];
  const categories = labels.map((day) => {
    const seriesKeys: DashboardDrilldownSeries[] = chartType === "burndown" ? ["remaining"] : ["total", "done"];
    const drilldowns = seriesKeys.map((key, index) => drilldown(widget, today, { kind: "day", day }, key, `${day} / ${series[index]}`));
    return {
      key: day,
      label: dayLabel(day),
      values: drilldowns.map((selection) => selectDashboardDrilldownTasks(tasks, selection).length),
      drilldowns,
    };
  });

  return {
    kind: "chart",
    categories,
    series,
    matched: tasks.length,
    benchmark: widget.options.benchmark ?? null,
    dataLabels: widget.options.data_labels === true,
    drilldown: drilldown(widget, today),
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
    const selection = drilldown(widget, today);
    return {
      kind: "number",
      categories: [],
      series: [],
      value: metricValue(selectDashboardDrilldownTasks(filtered, selection), widget.metric, today),
      matched: filtered.length,
      dataLabels: false,
      drilldown: selection,
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
