import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDay } from "./calendar";
import { filterCalendarTasks, type CalendarFilter } from "./use-calendar-filters";
import type { TaskRow } from "./repositories/projects";

const base: CalendarFilter = {
  completed: "",
  assignee: "",
  status: "",
  custom: {},
  due: "",
  created: "",
  updated: "",
  completedOn: "",
  creator: "",
  weekends: true,
  multi: true,
  color: "none",
  weekStart: 0,
};

function task(overrides: Partial<TaskRow> & { id: number; name: string }): TaskRow {
  return {
    project_id: 1,
    section_id: 1,
    parent_task_id: null,
    description: "",
    assignee_id: null,
    assignee_name: null,
    created_by: 1,
    creator_name: "管理者",
    completed: false,
    completed_at: null,
    start_on: null,
    due_on: null,
    progress: 0,
    status: "inbox",
    is_milestone: false,
    position: 0,
    created_at: "2026-11-01",
    updated_at: "2026-11-01",
    recurrence: "none",
    comment_count: 0,
    subtask_count: 0,
    ...overrides,
  } as TaskRow;
}

const todayDay = parseDay("2026-11-09");
const tasks = [
  task({ id: 1, name: "今日のタスク", due_on: "2026-11-09", created_at: "2026-11-09" }),
  task({ id: 2, name: "完了タスク", completed: true, due_on: "2026-11-09", completed_at: "2026-11-09", created_at: "2026-11-08" }),
  task({ id: 3, name: "期限超過", due_on: "2026-11-01", created_at: "2026-11-01" }),
  task({ id: 4, name: "日付なし", created_at: "2026-11-05" }),
  task({ id: 5, name: "古いタスク", due_on: "2026-11-09", created_at: "2026-10-01" }),
];

function run(overrides: Partial<CalendarFilter>, needle = "") {
  return filterCalendarTasks({
    tasks,
    filters: { ...base, ...overrides },
    customValues: {},
    statusFieldEnabled: true,
    todayDay,
    needle,
  }).map((t) => t.id);
}

test("calendar filters open and completed tasks", () => {
  assert.deepEqual(run({ completed: "open" }), [1, 3, 4, 5]);
  assert.deepEqual(run({ completed: "done" }), [2]);
});

test("calendar filters due today and overdue", () => {
  assert.deepEqual(run({ due: "today" }), [1, 2, 5]);
  assert.deepEqual(run({ due: "overdue" }), [3]);
});

test("calendar filters created date windows", () => {
  assert.deepEqual(run({ created: "7" }), [1, 2, 4]);
});

test("calendar filters completion date windows", () => {
  assert.deepEqual(run({ completedOn: "7" }), [2]);
});

test("calendar filters by search text", () => {
  assert.deepEqual(run({}, "期限"), [3]);
});
