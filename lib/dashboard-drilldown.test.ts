import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDashboardWidget } from "./dashboard-compute";
import {
  DASHBOARD_DRILLDOWN_MAX_LENGTH,
  dashboardDrilldownHref,
  parseDashboardDrilldown,
  selectDashboardDrilldownTasks,
} from "./dashboard-drilldown";
import type { DashboardDrilldown, DashboardMeta, DashboardTask, DashboardWidget } from "./dashboard-types";

const TODAY = "2026-11-10";
const meta: DashboardMeta = {
  sections: [{ id: 1, name: "Same" }, { id: 2, name: "Same" }, { id: 3, name: "セクションなし" }],
  users: [{ id: 1, name: "Same" }, { id: 2, name: "Same" }],
  statusOptions: ["inbox", "done", "未設定"], statusFieldName: "Status", statusFieldEnabled: true,
};
const task = (id: number, extra: Partial<DashboardTask> = {}): DashboardTask => ({
  id, name: `Task ${id}`, section_id: 1, assignee_id: 1, assignee_name: "Same",
  status: "inbox", completed: false, due_on: TODAY, created_on: "2026-11-01",
  completed_on: null, progress: 0, ...extra,
});
const widget = (extra: Partial<DashboardWidget> = {}): DashboardWidget => ({
  id: 1, project_id: 1, title: "Task metric", widget_type: "chart", chart_type: "number",
  group_by: "completion", metric: "count", filters: {}, options: {}, position: 1, ...extra,
});
const descriptor = (extra: Partial<DashboardDrilldown> = {}): DashboardDrilldown => ({
  v: 1, title: "Task metric", filters: {}, metric: "count", chartType: "number",
  groupBy: "completion", asOfDay: TODAY, seriesKey: "all", ...extra,
});
const selected = (tasks: DashboardTask[], selection: DashboardDrilldown) =>
  selectDashboardDrilldownTasks(tasks, selection).map((t) => t.id);

test("number cards select contributors to their metric instead of their unfiltered source", () => {
  const tasks = [task(1), task(2, { completed: true }), task(3, { due_on: "2026-11-09" }),
    task(4, { completed: true, due_on: "2026-11-08" }), task(5, { due_on: null })];
  for (const [metric, expected] of [
    ["count", [1, 2, 3, 4, 5]], ["completed", [2, 4]], ["incomplete", [1, 3, 5]], ["overdue", [3]],
  ] as const) {
    const data = computeDashboardWidget(widget({ metric }), tasks, meta, TODAY);
    assert.ok(data.drilldown);
    assert.deepEqual(selected(tasks, data.drilldown), expected);
    assert.equal(data.value, expected.length);
  }
});

test("contradictory widget and metric conditions remain an empty conjunction", () => {
  const tasks = [task(1), task(2, { completed: true })];
  const data = computeDashboardWidget(widget({ metric: "incomplete", filters: { completion: "done" } }), tasks, meta, TODAY);
  assert.equal(data.value, 0);
  assert.ok(data.drilldown);
  assert.deepEqual(selected(tasks, data.drilldown), []);
  assert.ok(parseDashboardDrilldown(new URL(dashboardDrilldownHref(1, data.drilldown), "http://atlas.local").searchParams.get("dashboard")));
});

test("exact dashboard due endpoints and the captured reference day survive navigation", () => {
  const tasks = [task(1, { due_on: "2026-11-09" }), task(2), task(3, { due_on: "2026-11-17" }),
    task(4, { due_on: "2026-11-18" }), task(5, { due_on: "2026-12-10" }), task(6, { due_on: "2026-12-11" }),
    task(7, { completed: true, due_on: "2026-11-09" })];
  assert.deepEqual(selected(tasks, descriptor({ filters: { due: "week" } })), [2, 3]);
  assert.deepEqual(selected(tasks, descriptor({ filters: { due: "month" } })), [2, 3, 4, 5]);
  assert.deepEqual(selected(tasks, descriptor({ filters: { due: "overdue" } })), [1]);
  assert.deepEqual(selected(tasks, descriptor({ filters: { due: "today" } })), [2]);
});

test("every base filter is intersected, including effective section and a hidden status", () => {
  const tasks = [task(1), task(2, { section_id: 2 }), task(3, { assignee_id: null }),
    task(4, { status: "done" }), task(5, { completed: true }), task(6, { due_on: null })];
  assert.deepEqual(selected(tasks, descriptor({ filters: { completion: "open", section: 1, assignee: 1, status: "inbox", due: "today" } })), [1]);
  assert.deepEqual(selected(tasks, descriptor({ filters: { assignee: "none" } })), [3]);
  // Status visibility is a UI preference, not permission to widen a condition snapshot.
  assert.deepEqual(selected(tasks, descriptor({ filters: { status: "done" } })), [4]);
});

test("same-name assignees and sections keep independent stable categories", () => {
  const tasks = [task(1), task(2, { section_id: 2, assignee_id: 2 }), task(3, { section_id: null, assignee_id: null })];
  for (const group_by of ["section", "assignee"] as const) {
    const data = computeDashboardWidget(widget({ chart_type: "bar", group_by }), tasks, meta, TODAY);
    assert.equal(data.categories.length, 3);
    assert.equal(new Set(data.categories.map((c) => c.key)).size, 3);
    assert.deepEqual(data.categories.map((c) => selected(tasks, c.drilldowns[0])), [[1], [2], [3]]);
    assert.deepEqual(data.categories.map((c) => c.values), [[1], [1], [1]]);
  }
});

test("NULL buckets cannot collide with literal sentinel-like names", () => {
  const tasks = [task(1, { section_id: null, status: "" }), task(2, { section_id: 3, status: "未設定" })];
  for (const group_by of ["section", "status"] as const) {
    const data = computeDashboardWidget(widget({ chart_type: "donut", group_by }), tasks, meta, TODAY);
    assert.equal(data.categories.length, 2);
    assert.equal(data.categories[0].label, data.categories[1].label);
    assert.notEqual(data.categories[0].key, data.categories[1].key);
    assert.deepEqual(data.categories.flatMap((c) => selected(tasks, c.drilldowns[0])).sort(), [1, 2]);
  }
});

test("stacked and grouped cells count their series even when another metric was configured", () => {
  const tasks = [task(1), task(2, { completed: true }), task(3, { completed: true })];
  for (const chart_type of ["stacked_bar", "grouped_bar"] as const) {
    const data = computeDashboardWidget(widget({ chart_type, group_by: "section", metric: "progress_sum" }), tasks, meta, TODAY);
    assert.deepEqual(data.categories[0].values, [1, 2]);
    assert.deepEqual(data.categories[0].drilldowns.map((d) => selected(tasks, d)), [[1], [2, 3]]);
    const openOnly = computeDashboardWidget(widget({ chart_type, group_by: "section", filters: { completion: "open" } }), tasks, meta, TODAY);
    assert.deepEqual(openOnly.categories[0].values, [1, 0]);
    assert.deepEqual(selected(tasks, openOnly.categories[0].drilldowns[1]), []);
  }
});

test("date buckets include the year and keep undated tasks separate", () => {
  const tasks = [task(1, { due_on: "2025-11-10", created_on: "2025-11-10" }),
    task(2, { due_on: TODAY, created_on: TODAY }), task(3, { due_on: null, created_on: "2026-12-01" })];
  const data = computeDashboardWidget(widget({ chart_type: "bar", group_by: "due_month" }), tasks, meta, TODAY);
  assert.equal(data.categories.length, 3);
  for (const category of data.categories) assert.equal(selected(tasks, category.drilldowns[0]).length, category.values[0]);
  assert.deepEqual(selected(tasks, data.categories.find((c) => c.label === "期限なし")!.drilldowns[0]), [3]);
  const created = computeDashboardWidget(widget({ chart_type: "bar", group_by: "created_month" }), tasks, meta, TODAY);
  assert.deepEqual(created.categories.map((c) => selected(tasks, c.drilldowns[0])), [[1], [2], [3]]);
});

test("time points use cumulative membership and full ISO days across a year boundary", () => {
  const tasks = [task(1, { created_on: "2025-12-20" }), task(2, { created_on: "2025-12-31", completed: true, completed_on: "2026-01-01" }),
    task(3, { created_on: "2026-01-02" })];
  for (const chart_type of ["line", "burnup"] as const) {
    const data = computeDashboardWidget(widget({ chart_type, metric: "progress_sum", options: { range_days: 7 } }), tasks, meta, "2026-01-02");
    const point = data.categories.find((c) => c.key === "2026-01-01")!;
    assert.deepEqual(point.values, [2, 1]);
    assert.deepEqual(point.drilldowns.map((d) => selected(tasks, d)), [[1, 2], [2]]);
    assert.equal(point.drilldowns[0].category?.kind, "day");
    assert.ok(parseDashboardDrilldown(JSON.stringify(point.drilldowns[0])));
  }
});

test("burndown displays actual remaining contributors, including inconsistent legacy dates", () => {
  const tasks = [task(1, { created_on: "2026-01-01" }), task(2, { created_on: "2026-01-02", completed_on: "2026-01-03" }),
    task(3, { created_on: "2026-01-04", completed_on: "2026-01-01" })];
  const data = computeDashboardWidget(widget({ chart_type: "burndown", options: { range_days: 7 } }), tasks, meta, "2026-01-03");
  const point = data.categories.at(-1)!;
  assert.deepEqual(point.values, [1]);
  assert.deepEqual(selected(tasks, point.drilldowns[0]), [1]);
});

test("progress aggregate links retain every contributor, including zeros", () => {
  const tasks = [task(1), task(2, { progress: 50 }), task(3, { progress: 100 })];
  for (const [metric, value] of [["progress_avg", 50], ["progress_sum", 150]] as const) {
    const data = computeDashboardWidget(widget({ metric }), tasks, meta, TODAY);
    assert.equal(data.value, value);
    assert.deepEqual(selected(tasks, data.drilldown!), [1, 2, 3]);
  }
  const zero = computeDashboardWidget(widget({ metric: "progress_avg" }), [task(1), task(2)], meta, TODAY);
  assert.equal(zero.value, 0);
  assert.deepEqual(selected([task(1), task(2)], zero.drilldown!), [1, 2]);
  const empty = computeDashboardWidget(widget(), [], meta, TODAY);
  assert.equal(empty.value, 0);
  assert.ok(empty.drilldown);
});

test("URL round trips preserve condition identity and encode hostile display text safely", () => {
  const original = descriptor({ title: "集計 & ? # <script>", filters: { status: "review & QA", section: 9 } });
  const href = dashboardDrilldownHref(7, original);
  const url = new URL(href, "http://atlas.local");
  assert.equal(url.pathname, "/projects/7");
  assert.equal(url.searchParams.get("view"), "list");
  assert.equal(url.searchParams.has("saved"), false);
  assert.deepEqual(parseDashboardDrilldown(url.searchParams.get("dashboard")), original);
  assert.throws(() => dashboardDrilldownHref(-1, original));
});

test("parser rejects malformed, oversized, unsafe-ID and unknown-field conditions", () => {
  const valid = descriptor();
  const invalid: unknown[] = [undefined, "", "not JSON", "null", "[]", " ".repeat(DASHBOARD_DRILLDOWN_MAX_LENGTH + 1),
    JSON.stringify({ ...valid, v: 2 }), JSON.stringify({ ...valid, title: "" }),
    JSON.stringify({ ...valid, metric: "unknown" }), JSON.stringify({ ...valid, chartType: "table" }),
    JSON.stringify({ ...valid, groupBy: "unknown" }), JSON.stringify({ ...valid, asOfDay: "2026-02-30" }),
    JSON.stringify({ ...valid, asOfDay: "0000-01-01" }), JSON.stringify({ ...valid, asOfDay: "2026-1-1" }),
    JSON.stringify({ ...valid, asOfDay: "2026-01-01T00:00:00Z" }), JSON.stringify({ ...valid, extra: true }),
    JSON.stringify({ ...valid, filters: { section: 0 } }), JSON.stringify({ ...valid, filters: { assignee: -1 } }),
    JSON.stringify({ ...valid, filters: { assignee: Number.MAX_SAFE_INTEGER + 1 } }),
    JSON.stringify({ ...valid, filters: { section: 1.5 } }), JSON.stringify({ ...valid, filters: { status: 123 } }),
    JSON.stringify({ ...valid, filters: { unknown: true } }), JSON.stringify({ ...valid, category: null }),
    JSON.stringify({ ...valid, seriesKey: null }),
  ];
  for (const raw of invalid) assert.equal(parseDashboardDrilldown(raw), null);
  assert.ok(parseDashboardDrilldown(JSON.stringify({ ...valid, asOfDay: "2024-02-29" })));
});

test("parser validates category shape, compatibility and series semantics", () => {
  const base = descriptor({ chartType: "bar", groupBy: "section" });
  const invalid = [
    { category: { kind: "section", id: "1" } }, { category: { kind: "section", id: 1, extra: true } },
    { category: { kind: "assignee", id: 1 } }, { category: { kind: "day", day: TODAY } },
    { seriesKey: "done" }, { category: { kind: "section" } },
  ];
  for (const change of invalid) assert.equal(parseDashboardDrilldown(JSON.stringify({ ...base, ...change })), null);
  assert.ok(parseDashboardDrilldown(JSON.stringify({ ...base, category: { kind: "section", id: null } })));
  assert.equal(parseDashboardDrilldown(JSON.stringify(descriptor({ chartType: "line", category: { kind: "day", day: "2026-11-11" }, seriesKey: "total" }))), null);
  assert.equal(parseDashboardDrilldown(JSON.stringify(descriptor({ chartType: "burndown", category: { kind: "day", day: TODAY }, seriesKey: "done" }))), null);
  assert.equal(parseDashboardDrilldown(JSON.stringify(descriptor({ chartType: "bar", groupBy: "due_month", category: { kind: "due_month", month: "2026-13" } }))), null);
});

test("selection does not mutate tasks or the frozen descriptor", () => {
  const tasks = [task(1), task(2, { completed: true })];
  const selection = descriptor({ metric: "incomplete" });
  const before = structuredClone({ tasks, selection });
  assert.deepEqual(selected(tasks, selection), [1]);
  assert.deepEqual({ tasks, selection }, before);
});

test("valid extreme years remain bounded and generate parseable time points", () => {
  const ancient = task(1, { created_on: "0001-01-01", due_on: "0001-01-01" });
  const data = computeDashboardWidget(widget({ chart_type: "line" }), [ancient], meta, "0001-01-01");
  assert.equal(data.categories.length, 1);
  assert.equal(data.categories[0].key, "0001-01-01");
  assert.ok(parseDashboardDrilldown(JSON.stringify(data.categories[0].drilldowns[0])));
  assert.deepEqual(selected([task(1, { due_on: "9999-12-31" })], descriptor({ asOfDay: "9999-12-31", filters: { due: "month" } })), [1]);
});

test("every categorical count cell round trips and partitions its metric contributors", () => {
  const tasks = [task(1), task(2, { section_id: 2, assignee_id: 2, completed: true, completed_on: TODAY }),
    task(3, { section_id: null, assignee_id: null, status: "", due_on: null }),
    task(4, { section_id: 3, status: "未設定", due_on: "2026-11-09", created_on: "2025-12-31" })];
  for (const chart_type of ["bar", "lollipop", "donut"] as const) {
    for (const group_by of ["section", "assignee", "status", "completion", "due_month", "created_month"] as const) {
      for (const metric of ["count", "completed", "incomplete", "overdue"] as const) {
        const data = computeDashboardWidget(widget({ chart_type, group_by, metric }), tasks, meta, TODAY);
        const all: number[] = [];
        for (const category of data.categories) {
          const parsed = parseDashboardDrilldown(JSON.stringify(category.drilldowns[0]));
          assert.ok(parsed, `${chart_type}/${group_by}/${metric}/${category.key}`);
          const rows = selected(tasks, parsed);
          assert.equal(rows.length, category.values[0]);
          all.push(...rows);
        }
        assert.equal(new Set(all).size, all.length);
        assert.deepEqual(all.sort(), selected(tasks, data.drilldown!).sort());
      }
    }
  }
});
