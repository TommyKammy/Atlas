import assert from "node:assert/strict";
import { test } from "node:test";
import {
  overdueBadgeText,
  overdueDays,
  subtaskProgressText,
  subtaskSummary,
  taskStateSummary,
} from "./task-pane-presentation";

const today = "2026-11-17";

test("overdueDays counts whole calendar days and ignores today, future and empty due dates", () => {
  assert.equal(overdueDays("2026-11-14", today), 3);
  assert.equal(overdueDays("2026-11-16", today), 1);
  assert.equal(overdueDays("2026-11-17", today), 0);
  assert.equal(overdueDays("2026-11-18", today), 0);
  assert.equal(overdueDays(null, today), 0);
});

test("overdueDays crosses month and year boundaries without drifting", () => {
  assert.equal(overdueDays("2026-10-31", "2026-11-02"), 2);
  assert.equal(overdueDays("2025-12-31", "2026-01-01"), 1);
  assert.equal(overdueDays("2024-02-28", "2024-03-01"), 2);
});

test("overdueBadgeText matches the mockup's spacing", () => {
  assert.equal(overdueBadgeText(3), "3日 超過");
  assert.equal(overdueBadgeText(1), "1日 超過");
});

test("taskStateSummary uses the list state word and the current progress", () => {
  const overdue = taskStateSummary(
    { completed: false, due_on: "2026-11-14", progress: 20 },
    today,
  );
  assert.deepEqual(overdue, { state: "overdue", label: "遅延", progress: 20, text: "遅延 ・ 20%" });

  const inProgress = taskStateSummary(
    { completed: false, due_on: "2026-11-20", progress: 60 },
    today,
  );
  assert.equal(inProgress.state, "in-progress");
  assert.equal(inProgress.text, "進行中 ・ 60%");

  const done = taskStateSummary(
    { completed: true, due_on: "2026-11-14", progress: 100 },
    today,
  );
  assert.equal(done.state, "complete");
  assert.equal(done.text, "完了 ・ 100%");

  const todo = taskStateSummary(
    { completed: false, due_on: null, progress: 0 },
    today,
  );
  assert.equal(todo.text, "未着手 ・ 0%");
});

test("taskStateSummary clamps progress to 0-100 for display", () => {
  assert.equal(
    taskStateSummary({ completed: false, due_on: null, progress: 140 }, today).progress,
    100,
  );
  assert.equal(
    taskStateSummary({ completed: false, due_on: null, progress: -5 }, today).progress,
    0,
  );
});

test("subtaskSummary reports completed over total for the section heading", () => {
  const summary = subtaskSummary([
    { completed: true },
    { completed: false },
  ]);
  assert.deepEqual(summary, { completed: 1, total: 2, text: "1 / 2" });

  assert.deepEqual(subtaskSummary([]), { completed: 0, total: 0, text: "0 / 0" });
  assert.equal(subtaskProgressText(2, 3), "2 / 3");
});
