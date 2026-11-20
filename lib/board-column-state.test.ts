import assert from "node:assert/strict";
import { test } from "node:test";
import { boardColumnState } from "./board-column-state";

test("boardColumnState maps the default status options to the four row states", () => {
  assert.equal(boardColumnState("未着手"), "todo");
  assert.equal(boardColumnState("進行中"), "in-progress");
  assert.equal(boardColumnState("完了"), "complete");
  assert.equal(boardColumnState("Done"), "complete");
});

test("boardColumnState recognizes the English and overdue labels", () => {
  assert.equal(boardColumnState("To Do"), "todo");
  assert.equal(boardColumnState("In Progress"), "in-progress");
  assert.equal(boardColumnState("Completed"), "complete");
  assert.equal(boardColumnState("期限超過"), "overdue");
  assert.equal(boardColumnState("Overdue"), "overdue");
});

test("boardColumnState leaves custom, empty and missing statuses without an icon", () => {
  assert.equal(boardColumnState("レビュー待ち"), null);
  assert.equal(boardColumnState(""), null);
  assert.equal(boardColumnState(null), null);
  assert.equal(boardColumnState(undefined), null);
});
