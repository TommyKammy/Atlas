import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIST_ROW_STATE_LABELS,
  countOverdueTasks,
  listRowState,
  listSummaryText,
  listTaskSummary,
  type ListRowState,
} from "./list-row-state";

const today = "2026-11-17";

function task(overrides: { completed?: boolean; due_on?: string | null; progress?: number }) {
  return {
    completed: overrides.completed ?? false,
    due_on: overrides.due_on ?? null,
    progress: overrides.progress ?? 0,
  };
}

test("listRowState prefers completion over a past due date", () => {
  assert.equal(listRowState(task({ completed: true, due_on: "2026-11-10", progress: 100 }), today), "complete");
  assert.equal(listRowState(task({ completed: true }), today), "complete");
});

test("listRowState marks unfinished past-due tasks as overdue before in-progress", () => {
  assert.equal(listRowState(task({ due_on: "2026-11-16", progress: 60 }), today), "overdue");
  assert.equal(listRowState(task({ due_on: today, progress: 60 }), today), "in-progress");
});

test("listRowState treats progress above zero as in progress and the rest as todo", () => {
  assert.equal(listRowState(task({ progress: 1 }), today), "in-progress");
  assert.equal(listRowState(task({ progress: 100 }), today), "in-progress");
  assert.equal(listRowState(task({ progress: 0 }), today), "todo");
});

test("listTaskSummary counts only the visible tasks and omits zero overdue from the text", () => {
  const visible = [
    task({ completed: true, due_on: "2026-11-01" }),
    task({ due_on: "2026-11-10" }),
    task({ due_on: "2026-11-17" }),
    task({ due_on: "2026-11-20", progress: 40 }),
  ];
  const summary = listTaskSummary(visible, today);
  assert.deepEqual(summary, { total: 4, completed: 1, overdue: 1 });
  assert.equal(listSummaryText(summary), "4件 ・ 完了 1 ・ 期限超過 1");

  const noneOverdue = listTaskSummary(visible.slice(0, 1).concat(visible.slice(2)), today);
  assert.deepEqual(noneOverdue, { total: 3, completed: 1, overdue: 0 });
  assert.equal(listSummaryText(noneOverdue), "3件 ・ 完了 1");
});

test("countOverdueTasks counts unfinished tasks before today only", () => {
  const tasks = [
    task({ due_on: "2026-11-16", progress: 60 }),
    task({ due_on: "2026-11-10" }),
    task({ completed: true, due_on: "2026-11-10", progress: 100 }),
    task({ due_on: today }),
    task({ due_on: "2026-11-20", progress: 40 }),
    task({ due_on: null, progress: 80 }),
  ];
  assert.equal(countOverdueTasks(tasks, today), 2);
  assert.equal(countOverdueTasks([], today), 0);
  assert.equal(countOverdueTasks([task({ completed: true, due_on: "2026-11-01" })], today), 0);
});

test("every row state has a Japanese label", () => {
  const states: ListRowState[] = ["complete", "overdue", "in-progress", "todo"];
  assert.deepEqual(
    states.map((state) => LIST_ROW_STATE_LABELS[state]),
    ["完了", "遅延", "進行中", "未着手"],
  );
});
