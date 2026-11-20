import assert from "node:assert/strict";
import test from "node:test";
import { isCriticalDependency, timelineBarAriaLabel } from "./timeline-display";
import type { TaskTimelineRow } from "./timeline-task-payload";

const task = (overrides: Partial<TaskTimelineRow> = {}): TaskTimelineRow => ({
  id: 1,
  project_id: 1,
  section_id: 2,
  parent_task_id: null,
  name: "非機能要件のレビュー",
  assignee_id: 2,
  assignee_name: "鈴木",
  created_by: 1,
  completed: false,
  completed_at: null,
  start_on: "2026-11-10",
  due_on: "2026-11-12",
  progress: 60,
  status: "進行中",
  is_milestone: false,
  position: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  subtask_count: 2,
  approval: null,
  eff_section_id: 2,
  timeline_row: null,
  timeline_row_updated_at: null,
  ...overrides,
});

test("timeline bar label includes the four-state word", () => {
  assert.match(timelineBarAriaLabel(task(), "todo", false), /状態: 未着手$/);
  assert.match(timelineBarAriaLabel(task({ progress: 20 }), "in-progress", false), /状態: 進行中$/);
  assert.match(timelineBarAriaLabel(task({ completed: true }), "complete", false), /状態: 完了$/);
});

test("timeline bar label names overdue separately from color", () => {
  const label = timelineBarAriaLabel(task(), "overdue", false);
  assert.match(label, /状態: 遅延・期限超過$/);
  assert.match(label, /非機能要件のレビュー/);
  assert.match(label, /2026-11-10 〜 2026-11-12/);
  assert.match(label, /進捗60%/);
  assert.match(label, /担当鈴木/);
});

test("timeline bar label keeps the existing critical-path expression", () => {
  const label = timelineBarAriaLabel(task(), "in-progress", true);
  assert.match(label, /【クリティカルパス】/);
  assert.equal(timelineBarAriaLabel(task({ completed: true }), "complete", true).includes("【クリティカルパス】"), false);
});

test("timeline bar label mentions a locked row", () => {
  assert.match(
    timelineBarAriaLabel(task({ timeline_row: 2, timeline_row_updated_at: "2026-11-01T00:00:00Z" }), "todo", false),
    /行固定/,
  );
});

test("a dependency is critical only when both endpoints are critical", () => {
  const critical = new Set([1, 2]);
  assert.equal(isCriticalDependency({ depends_on_id: 1, task_id: 2 }, critical), true);
  assert.equal(isCriticalDependency({ depends_on_id: 1, task_id: 3 }, critical), false);
  assert.equal(isCriticalDependency({ depends_on_id: 3, task_id: 2 }, critical), false);
  assert.equal(isCriticalDependency({ depends_on_id: 1, task_id: 2 }, new Set()), false);
});
