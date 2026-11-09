import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustomField, CustomValue } from "./custom-fields";
import type { TaskRow, User } from "./data";
import { groupKeyFor, groupTasks, sortGroupEntries } from "./list-grouping";

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
    is_milestone: false,
    position: overrides.id * 1000,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
    recurrence: "none",
    comment_count: 0,
    subtask_count: 0,
    ...overrides,
  };
}

const users: User[] = [{ id: 1, name: "Admin", is_guest: false }];
const customFields: CustomField[] = [
  { id: 5, name: "Text", field_type: "text", options: [] },
];
const customValues: Record<number, Record<number, CustomValue>> = {
  1: { 5: { value_text: "Alpha", value_number: null } },
};

test("groupKeyFor maps built-in group keys", () => {
  const value = task({
    id: 1,
    assignee_name: "Tanaka",
    creator_name: "Sato",
    status: "進行中",
    due_on: "2026-11-10",
    start_on: "2026-11-01",
    completed: true,
    completed_at: "2026-11-09T00:00:00Z",
    project_name: "Atlas",
  });
  const context = { customFields, customValues, users };

  assert.equal(groupKeyFor(value, "assignee", context), "Tanaka");
  assert.equal(groupKeyFor(value, "creator", context), "Sato");
  assert.equal(groupKeyFor(value, "status", context), "進行中");
  assert.equal(groupKeyFor(value, "due", context), "2026-11-10");
  assert.equal(groupKeyFor(value, "start", context), "2026-11-01");
  assert.equal(groupKeyFor(value, "created", context), "2026-11-01");
  assert.equal(groupKeyFor(value, "updated", context), "2026-11-02");
  assert.equal(groupKeyFor(value, "completed", context), "2026-11-09");
  assert.equal(groupKeyFor(value, "project", context), "Atlas");
  assert.equal(groupKeyFor(value, "cf-5", context), "Alpha");
  assert.equal(groupKeyFor(task({ id: 2 }), "assignee", context), "（未割当）");
  assert.equal(groupKeyFor(task({ id: 2 }), "completed", context), "（未完了）");
});

test("sortGroupEntries puts unset buckets last and respects direction", () => {
  const entries: [string, TaskRow[]][] = [
    ["（未設定）", [task({ id: 1 })]],
    ["B", [task({ id: 2 })]],
    ["A", [task({ id: 3 })]],
  ];
  assert.deepEqual(sortGroupEntries(entries, "asc").map(([key]) => key), ["A", "B", "（未設定）"]);
  assert.deepEqual(sortGroupEntries(entries, "desc").map(([key]) => key), ["B", "A", "（未設定）"]);
});

test("groupTasks groups and sorts within buckets", () => {
  const items = [
    task({ id: 1, assignee_name: "Tanaka", due_on: "2026-11-10" }),
    task({ id: 2, assignee_name: "Tanaka", due_on: "2026-11-01" }),
    task({ id: 3, assignee_name: "Sato", due_on: "2026-11-05" }),
  ];
  const context = { customFields, customValues, users };
  const groups = groupTasks(items, "assignee", context, "due", "asc", "asc");

  assert.deepEqual(groups.map(([key]) => key), ["Sato", "Tanaka"]);
  assert.deepEqual(groups[1][1].map((item) => item.id), [2, 1]);
});
