import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_SELECT_COLS, TASK_TIMELINE_COLS } from "./repositories/task-select";
import { TASK_RULE_SNAPSHOT_SQL } from "./repositories/task-rule-snapshot";

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
