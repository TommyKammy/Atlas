import {
  normaliseWidgetFilters,
  normaliseWidgetOptions,
} from "./dashboard-compute";
import type { DashboardWidget } from "./dashboard-types";

const CHART_TYPES = new Set<DashboardWidget["chart_type"]>([
  "bar",
  "stacked_bar",
  "grouped_bar",
  "line",
  "burnup",
  "burndown",
  "donut",
  "number",
  "lollipop",
]);
const GROUP_BYS = new Set<DashboardWidget["group_by"]>([
  "section",
  "assignee",
  "status",
  "completion",
  "due_month",
  "created_month",
]);
const METRICS = new Set<DashboardWidget["metric"]>([
  "count",
  "completed",
  "incomplete",
  "overdue",
  "progress_avg",
  "progress_sum",
]);

export type WidgetPayload = {
  title: string;
  widget_type: DashboardWidget["widget_type"];
  chart_type: DashboardWidget["chart_type"];
  group_by: DashboardWidget["group_by"];
  metric: DashboardWidget["metric"];
  filters: DashboardWidget["filters"];
  options: DashboardWidget["options"];
  body: string;
};

export function parseWidgetPayload(
  body: unknown,
  opts: { partial?: boolean } = {},
): { ok: true; value: Partial<WidgetPayload> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid widget payload" };
  const raw = body as Record<string, unknown>;
  const value: Partial<WidgetPayload> = {};

  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || raw.title.trim() === "") {
      return { ok: false, error: "widget title is required" };
    }
    value.title = raw.title.trim().slice(0, 120);
  } else if (!opts.partial) {
    return { ok: false, error: "widget title is required" };
  }

  if (raw.widget_type !== undefined) {
    if (raw.widget_type !== "chart" && raw.widget_type !== "text") {
      return { ok: false, error: "invalid widget type" };
    }
    value.widget_type = raw.widget_type;
  }

  if (raw.chart_type !== undefined) {
    if (typeof raw.chart_type !== "string" || !CHART_TYPES.has(raw.chart_type as DashboardWidget["chart_type"])) {
      return { ok: false, error: "invalid chart type" };
    }
    value.chart_type = raw.chart_type as DashboardWidget["chart_type"];
  }

  if (raw.group_by !== undefined) {
    if (typeof raw.group_by !== "string" || !GROUP_BYS.has(raw.group_by as DashboardWidget["group_by"])) {
      return { ok: false, error: "invalid group by" };
    }
    value.group_by = raw.group_by as DashboardWidget["group_by"];
  }

  if (raw.metric !== undefined) {
    if (typeof raw.metric !== "string" || !METRICS.has(raw.metric as DashboardWidget["metric"])) {
      return { ok: false, error: "invalid metric" };
    }
    value.metric = raw.metric as DashboardWidget["metric"];
  }

  if (raw.filters !== undefined) value.filters = normaliseWidgetFilters(raw.filters);
  if (raw.options !== undefined) {
    const options = normaliseWidgetOptions(raw.options);
    if (options.range_days !== undefined) {
      options.range_days = [7, 14, 30, 90].includes(options.range_days) ? options.range_days : 30;
    }
    value.options = options;
  }
  if (raw.body !== undefined) {
    if (typeof raw.body !== "string") return { ok: false, error: "invalid widget body" };
    value.body = raw.body.slice(0, 5000);
  }

  if (!opts.partial) {
    value.widget_type = value.widget_type ?? "chart";
    value.chart_type = value.chart_type ?? "bar";
    value.group_by = value.group_by ?? "section";
    value.metric = value.metric ?? "count";
    value.filters = value.filters ?? {};
    value.options = value.options ?? {};
    value.body = value.body ?? "";
  }
  return { ok: true, value };
}
