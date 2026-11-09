import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_SELECT_COLS, TASK_TIMELINE_COLS } from "./repositories/task-select";
import { TASK_RULE_SNAPSHOT_SQL } from "./repositories/task-rule-snapshot";
import {
  TASK_PROJECTIONS,
  taskProjection,
  toTaskDetail,
  toTaskSummary,
  toTaskTimelineRow,
} from "./repositories/task-projection";
import type { TaskRow } from "./repositories/projects";

test("timeline projection keeps the fields the timeline renders", () => {
  for (const column of [
    "t.id",
    "t.start_on::text",
    "t.due_on::text",
    "t.progress",
    "t.is_milestone",
    "t.assignee_id",
    "t.updated_at::text",
    "subtask_count",
  ]) {
    assert.ok(TASK_TIMELINE_COLS.includes(column), column);
  }
});

test("timeline projection drops list-only aggregates", () => {
  for (const column of [
    "like_count",
    "comment_count",
    "attachment_count",
    "blocked_by_count",
    "blocking_count",
    "collaborators",
    "project_name",
  ]) {
    assert.equal(TASK_TIMELINE_COLS.includes(column), false, column);
  }
});

test("the full projection still exposes list-only aggregates", () => {
  for (const column of [
    "like_count",
    "comment_count",
    "attachment_count",
    "blocked_by_count",
    "blocking_count",
    "collaborators",
    "project_name",
  ]) {
    assert.ok(TASK_SELECT_COLS.includes(column), column);
  }
});

test("automation snapshots include milestone and date fields", () => {
  for (const column of ["t.is_milestone", "t.start_on::text AS start_on", "t.due_on::text AS due_on"]) {
    assert.ok(TASK_RULE_SNAPSHOT_SQL.includes(column), column);
  }
});

test("the projection registry maps summary, timeline and detail", () => {
  assert.equal(taskProjection("summary"), TASK_SELECT_COLS);
  assert.equal(taskProjection("timeline"), TASK_TIMELINE_COLS);
  assert.equal(taskProjection("detail"), TASK_SELECT_COLS);
  assert.deepEqual(Object.keys(TASK_PROJECTIONS).sort(), ["detail", "summary", "timeline"]);
});

test("summary and detail projections include the full list aggregates", () => {
  for (const kind of ["summary", "detail"] as const) {
    assert.ok(taskProjection(kind).includes("comment_count"), kind);
    assert.ok(taskProjection(kind).includes("collaborators"), kind);
  }
});

const row = {
  id: "7",
  project_id: "1",
  section_id: null,
  parent_task_id: null,
  name: "投影テスト",
  description: "",
  assignee_id: null,
  assignee_name: null,
  created_by: "1",
  creator_name: "管理者",
  completed: false,
  completed_at: null,
  start_on: "2026-11-09",
  due_on: "2026-11-10",
  progress: "0",
  status: "inbox",
  is_milestone: false,
  position: "1000",
  created_at: "2026-11-09",
  updated_at: "2026-11-09",
  recurrence: "none",
  like_count: null,
  comment_count: null,
  subtask_count: null,
  attachment_count: null,
  blocked_by_count: null,
  blocking_count: null,
  collaborators: null,
  project_name: null,
} as unknown as TaskRow;

test("summary mapping normalizes counts and collaborators", () => {
  const summary = toTaskSummary(row);
  assert.equal(summary.id, 7);
  assert.equal(summary.like_count, 0);
  assert.equal(summary.comment_count, 0);
  assert.equal(summary.subtask_count, 0);
  assert.equal(summary.attachment_count, 0);
  assert.deepEqual(summary.collaborators, []);
});

test("timeline and detail mappings preserve the lighter/full read models", () => {
  const timeline = toTaskTimelineRow(row);
  assert.equal(timeline.id, 7);
  assert.equal(timeline.subtask_count, 0);
  const detail = toTaskDetail(row);
  assert.equal(detail.name, "投影テスト");
});
