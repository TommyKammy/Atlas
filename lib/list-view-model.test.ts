import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustomField, CustomValue } from "./custom-fields";
import type { TaskRow } from "./data";
import {
  aggregateListField,
  compareListTasks,
  dayOffset,
  filterListTasks,
  listFooterTotals,
} from "./list-view-model";

function task(overrides: Partial<TaskRow> & { id: number }): TaskRow {
  return {
    project_id: 1,
    section_id: null,
    parent_task_id: null,
    name: `Task ${overrides.id}`,
    description: "",
    assignee_id: null,
    assignee_name: null,
    created_by: 1,
    creator_name: "Admin",
    completed: false,
    completed_at: null,
    start_on: null,
    due_on: null,
    progress: 0,
    status: "未着手",
    position: overrides.id * 1000,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    recurrence: "none",
    comment_count: 0,
    subtask_count: 0,
    ...overrides,
  };
}

const baseFilter = {
  completedOnly: false,
  hideCompleted: false,
  mineOnly: false,
  assigneeFilter: "",
  statusFilter: "",
  statusFieldEnabled: true,
  creatorFilter: "",
  startFilter: "" as const,
  createdFilter: "" as const,
  updatedFilter: "" as const,
  completedDateFilter: "" as const,
  dueFilter: "",
  customFilter: {},
  shownFields: [] as CustomField[],
  customValues: {} as Record<number, Record<number, CustomValue>>,
  viewerId: 1,
  today: "2026-11-09",
};

test("filterListTasks applies completion, mine, assignee and status filters", () => {
  const tasks = [
    task({ id: 1, completed: false, assignee_id: 1, status: "未着手" }),
    task({ id: 2, completed: true, assignee_id: 2, status: "Done" }),
    task({ id: 3, completed: false, assignee_id: null, status: "進行中" }),
  ];

  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, hideCompleted: true }).map((t) => t.id),
    [1, 3],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, completedOnly: true }).map((t) => t.id),
    [2],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, mineOnly: true }).map((t) => t.id),
    [1],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, assigneeFilter: "none" }).map((t) => t.id),
    [3],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, statusFilter: "進行中" }).map((t) => t.id),
    [3],
  );
});

test("filterListTasks applies due windows and date ranges", () => {
  const tasks = [
    task({ id: 1, due_on: "2026-11-08" }),
    task({ id: 2, due_on: "2026-11-09" }),
    task({ id: 3, due_on: "2026-11-12" }),
    task({ id: 4, due_on: "2026-11-20" }),
    task({ id: 5, due_on: null, created_at: "2026-11-09T10:00:00Z" }),
  ];

  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, dueFilter: "overdue" }).map((t) => t.id),
    [1],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, dueFilter: "today" }).map((t) => t.id),
    [2],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, dueFilter: "week" }).map((t) => t.id),
    [2, 3],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, dueFilter: "nextweek" }).map((t) => t.id),
    [4],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, createdFilter: "today" }).map((t) => t.id),
    [5],
  );
  assert.deepEqual(
    filterListTasks(tasks, { ...baseFilter, dueFilter: "month" }).map((t) => t.id),
    [2, 3, 4],
  );
});

test("filterListTasks applies custom field filters", () => {
  const multi: CustomField = { id: 10, name: "Tags", field_type: "multi_select", options: [] };
  const people: CustomField = { id: 11, name: "People", field_type: "people", options: [] };
  const text: CustomField = { id: 12, name: "Text", field_type: "text", options: [] };
  const customValues: Record<number, Record<number, CustomValue>> = {
    1: {
      10: { value_text: "A, B", value_number: null, value_json: ["A", "B"] },
      11: { value_text: "Tanaka", value_number: null, value_json: [2] },
      12: { value_text: "hello", value_number: null },
    },
  };
  const tasks = [task({ id: 1 }), task({ id: 2 })];

  assert.deepEqual(
    filterListTasks(tasks, {
      ...baseFilter,
      shownFields: [multi],
      customFilter: { 10: "B" },
      customValues,
    }).map((t) => t.id),
    [1],
  );
  assert.deepEqual(
    filterListTasks(tasks, {
      ...baseFilter,
      shownFields: [people],
      customFilter: { 11: "2" },
      customValues,
    }).map((t) => t.id),
    [1],
  );
  assert.deepEqual(
    filterListTasks(tasks, {
      ...baseFilter,
      shownFields: [text],
      customFilter: { 12: "hello" },
      customValues,
    }).map((t) => t.id),
    [1],
  );
});

test("compareListTasks sorts dates, nullable text, likes and position", () => {
  const a = task({ id: 1, due_on: "2026-11-01", assignee_name: null, like_count: 2 });
  const b = task({ id: 2, due_on: "2026-11-09", assignee_name: "Tanaka", like_count: 5 });

  assert.ok(compareListTasks(a, b, "due", "asc") < 0);
  assert.ok(compareListTasks(a, b, "due", "desc") > 0);
  assert.ok(compareListTasks(a, b, "assignee", "asc") > 0);
  assert.ok(compareListTasks(a, b, "likes", "asc") < 0);
  assert.ok(compareListTasks(a, b, "position", "asc") < 0);
});

test("aggregateListField computes count/sum/average/min/max and includes subtasks", () => {
  const field: CustomField = {
    id: 1,
    name: "Estimate",
    field_type: "number",
    options: [],
    config: { column_function: "sum", include_subtasks: true },
  };
  const values: Record<number, Record<number, CustomValue>> = {
    10: { 1: { value_text: null, value_number: 2 } },
    11: { 1: { value_text: null, value_number: 3 } },
  };
  const parent = task({ id: 10 });
  const subtask = task({ id: 11, parent_task_id: 10 });

  const total = aggregateListField(field, [parent], values, { 10: [subtask] });
  assert.deepEqual(total, { label: "合計", value: "5" });

  const count = aggregateListField(
    { ...field, config: { column_function: "count" } },
    [parent, subtask],
    values,
    {},
  );
  assert.deepEqual(count, { label: "個数", value: "2" });

  const average = aggregateListField(
    { ...field, config: { column_function: "average" } },
    [parent, subtask],
    values,
    {},
  );
  assert.equal(average?.value, "3");

  const empty = aggregateListField({ ...field, config: { column_function: "count" } }, [task({ id: 99 })], values, {});
  assert.deepEqual(empty, { label: "個数", value: "0" });
});

test("listFooterTotals collects only fields with a configured function", () => {
  const fields: CustomField[] = [
    { id: 1, name: "Estimate", field_type: "number", options: [], config: { column_function: "sum" } },
    { id: 2, name: "Text", field_type: "text", options: [] },
  ];
  const totals = listFooterTotals(
    fields,
    [task({ id: 1 })],
    { 1: { 1: { value_text: null, value_number: 4 } } },
    {},
  );
  assert.deepEqual(totals, { 1: { label: "合計", value: "4" } });
});

test("dayOffset uses the supplied day and handles month boundaries", () => {
  assert.equal(dayOffset("2026-11-09", 6), "2026-11-15");
  assert.equal(dayOffset("2026-12-30", 3), "2027-01-02");
});
