import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_SELECT_COLS, TASK_TIMELINE_COLS } from "./repositories/task-select";
import { TASK_RULE_SNAPSHOT_SQL } from "./repositories/task-rule-snapshot";
import { decodeTimelineTask } from "./timeline-task-payload";
import {
  TASK_PROJECTIONS,
  taskProjection,
  toTaskDetail,
  toTaskSummary,
  toTimelineTaskPayload,
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
    "t.created_by",
    "t.created_at::text",
    "t.completed_at::text",
    "t.updated_at::text",
    "subtask_count",
  ]) {
    assert.ok(TASK_TIMELINE_COLS.includes(column), column);
  }
});

test("timeline projection drops fields used only in the task pane or other views", () => {
  for (const column of [
    "like_count",
    "comment_count",
    "attachment_count",
    "blocked_by_count",
    "blocking_count",
    "collaborators",
    "project_name",
    "t.description",
    "t.recurrence",
    "creator_name",
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

test("timeline transport keeps filter inputs, primary/effective sections and exact update versions", () => {
  const detailRow = {
    ...row,
    project_id: 2,
    section_id: 3,
    eff_section_id: 4,
    assignee_id: 5,
    assignee_name: "担当者",
    completed: true,
    completed_at: "2026-11-10 10:10:10.123456+09",
    progress: 75,
    subtask_count: 2,
    updated_at: "2026-11-10 10:20:10.123456+09",
    timeline_row: 0,
    timeline_row_updated_at: "2026-11-10 10:20:10.654321+09",
    description: "task-pane details",
    description_doc: { type: "doc", content: [] },
  } as TaskRow & { eff_section_id: number; timeline_row: number; timeline_row_updated_at: string };
  const payload = toTimelineTaskPayload(detailRow);
  assert.doesNotMatch(JSON.stringify(payload), /task-pane details|description|comment_count/);
  assert.deepEqual(decodeTimelineTask(payload), {
    id: 7, project_id: 2, section_id: 3, eff_section_id: 4, parent_task_id: null,
    name: "投影テスト", assignee_id: 5, assignee_name: "担当者", created_by: 1,
    completed: true, completed_at: detailRow.completed_at, start_on: "2026-11-09", due_on: "2026-11-10",
    progress: 75, status: "inbox", is_milestone: false, position: 1000, subtask_count: 2,
    created_at: "2026-11-09", updated_at: detailRow.updated_at,
    timeline_row: 0, timeline_row_updated_at: detailRow.timeline_row_updated_at,
  });
  const detail = toTaskDetail(detailRow);
  assert.equal(detail.description, detailRow.description);
  assert.deepEqual(detail.description_doc, detailRow.description_doc);

  const unpinned = decodeTimelineTask(toTimelineTaskPayload({
    ...detailRow, eff_section_id: null, timeline_row: null, timeline_row_updated_at: null,
  }));
  assert.equal(unpinned.eff_section_id, null);
  assert.equal(unpinned.timeline_row, null);
  assert.equal(unpinned.timeline_row_updated_at, null);
});

test("timeline preserves approval state and decision version without enlarging ordinary rows", () => {
  const task = { ...row, id: 9, project_id: 1, eff_section_id: null, timeline_row: null,
    timeline_row_updated_at: null } as TaskRow & { eff_section_id: null; timeline_row: null; timeline_row_updated_at: null };
  const ordinary = toTimelineTaskPayload(task);
  assert.equal(ordinary.length, 21);
  const approval = { status: "changes_requested" as const, approver_id: 2, approver_name: "承認者", version: 4, round: 2 };
  const payload = toTimelineTaskPayload({ ...task, approval });
  assert.equal(payload.length, 22);
  assert.deepEqual(decodeTimelineTask(payload).approval, approval);
  assert.equal(decodeTimelineTask(ordinary).approval, undefined);
});
