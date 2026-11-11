export type DashboardChartType =
  | "bar"
  | "stacked_bar"
  | "grouped_bar"
  | "line"
  | "burnup"
  | "burndown"
  | "donut"
  | "number"
  | "lollipop";

export type DashboardGroupBy =
  | "section"
  | "assignee"
  | "status"
  | "completion"
  | "due_month"
  | "created_month";

export type DashboardMetric =
  | "count"
  | "completed"
  | "incomplete"
  | "overdue"
  | "progress_avg"
  | "progress_sum";

export type DashboardFilter = {
  completion?: "all" | "open" | "done";
  assignee?: number | "none" | "";
  status?: string;
  due?: "" | "overdue" | "today" | "week" | "month";
  section?: number | "";
};

/** Stable selection identity; display labels never identify a chart bucket. */
export type DashboardDrilldownCategory =
  | { kind: "section"; id: number | null }
  | { kind: "assignee"; id: number | null }
  | { kind: "status"; value: string }
  | { kind: "completion"; completed: boolean }
  | { kind: "due_month"; month: string | null }
  | { kind: "created_month"; month: string }
  | { kind: "day"; day: string };

export type DashboardDrilldownSeries = "all" | "open" | "done" | "total" | "remaining";

/** A frozen condition snapshot, not a list of task IDs or a saved-view ID. */
export type DashboardDrilldown = {
  v: 1;
  title: string;
  filters: DashboardFilter;
  metric: DashboardMetric;
  chartType: DashboardChartType;
  groupBy: DashboardGroupBy;
  asOfDay: string;
  category?: DashboardDrilldownCategory;
  seriesKey?: DashboardDrilldownSeries;
};

export type DashboardWidgetOptions = {
  data_labels?: boolean;
  range_days?: number;
  benchmark?: number | null;
};

export type DashboardWidget = {
  id: number;
  project_id: number;
  title: string;
  widget_type: "chart" | "text";
  chart_type: DashboardChartType;
  group_by: DashboardGroupBy;
  metric: DashboardMetric;
  filters: DashboardFilter;
  options: DashboardWidgetOptions;
  body?: string;
  position: number;
  created_at?: string;
  updated_at?: string;
};

export type DashboardTask = {
  id: number;
  name: string;
  section_id: number | null;
  assignee_id: number | null;
  assignee_name: string | null;
  status: string;
  completed: boolean;
  due_on: string | null;
  created_on: string;
  completed_on: string | null;
  progress: number;
};

export type DashboardMeta = {
  sections: { id: number; name: string }[];
  users: { id: number; name: string }[];
  statusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
};

export const CHART_TYPE_LABELS: Record<DashboardChartType, string> = {
  bar: "棒グラフ",
  stacked_bar: "積み上げ棒グラフ",
  grouped_bar: "グループ化された棒グラフ",
  line: "折れ線グラフ",
  burnup: "バーンアップ",
  burndown: "バーンダウン",
  donut: "ドーナツ",
  number: "数値",
  lollipop: "ロリポップ",
};

export const GROUP_BY_LABELS: Record<DashboardGroupBy, string> = {
  section: "セクション",
  assignee: "担当者",
  status: "Status",
  completion: "完了ステータス",
  due_month: "期日（月）",
  created_month: "作成日（月）",
};

export const METRIC_LABELS: Record<DashboardMetric, string> = {
  count: "タスク数",
  completed: "完了タスク数",
  incomplete: "未完了タスク数",
  overdue: "期限超過タスク数",
  progress_avg: "進捗の平均",
  progress_sum: "進捗の合計",
};

export const TIME_CHART_TYPES: DashboardChartType[] = ["line", "burnup", "burndown"];

export function isTimeChart(type: DashboardChartType): boolean {
  return TIME_CHART_TYPES.includes(type);
}

export function isMultiSeriesChart(type: DashboardChartType): boolean {
  return type === "stacked_bar" || type === "grouped_bar";
}

/** Built-in widget set used when a project has no dashboard yet. */
export function defaultDashboardWidgets(): Omit<DashboardWidget, "id" | "project_id">[] {
  const base = { position: 0 };
  return [
    {
      ...base,
      title: "完了したタスクの合計",
      widget_type: "chart",
      chart_type: "number",
      group_by: "completion",
      metric: "completed",
      filters: {},
      options: {},
    },
    {
      ...base,
      title: "未完了のタスクの合計",
      widget_type: "chart",
      chart_type: "number",
      group_by: "completion",
      metric: "incomplete",
      filters: {},
      options: {},
    },
    {
      ...base,
      title: "期限超過のタスクの合計",
      widget_type: "chart",
      chart_type: "number",
      group_by: "due_month",
      metric: "overdue",
      filters: {},
      options: {},
    },
    {
      ...base,
      title: "タスクの合計",
      widget_type: "chart",
      chart_type: "number",
      group_by: "completion",
      metric: "count",
      filters: {},
      options: {},
    },
    {
      ...base,
      title: "未完了のタスクの合計 (セクション別)",
      widget_type: "chart",
      chart_type: "bar",
      group_by: "section",
      metric: "incomplete",
      filters: { completion: "open" },
      options: { data_labels: true },
    },
    {
      ...base,
      title: "タスクの合計 (完了ステータス別)",
      widget_type: "chart",
      chart_type: "donut",
      group_by: "completion",
      metric: "count",
      filters: {},
      options: { data_labels: true },
    },
    {
      ...base,
      title: "今後のタスクの合計 (担当者別)",
      widget_type: "chart",
      chart_type: "bar",
      group_by: "assignee",
      metric: "incomplete",
      filters: { due: "week" },
      options: { data_labels: true },
    },
    {
      ...base,
      title: "タスク完了の推移",
      widget_type: "chart",
      chart_type: "line",
      group_by: "created_month",
      metric: "count",
      filters: {},
      options: { range_days: 30, data_labels: false },
    },
    {
      ...base,
      title: "進捗の合計",
      widget_type: "chart",
      chart_type: "number",
      group_by: "completion",
      metric: "progress_sum",
      filters: {},
      options: {},
    },
    {
      ...base,
      title: "Status別タスク数",
      widget_type: "chart",
      chart_type: "bar",
      group_by: "status",
      metric: "count",
      filters: {},
      options: { data_labels: true },
    },
  ];
}
