import assert from "node:assert/strict";
import { test } from "node:test";
import { startStatusTarget } from "./task-start";

const OPTIONS = ["未着手", "進行中", "レビュー", "完了"];
const base = { startStatus: "進行中", statusOptions: OPTIONS, statusFieldEnabled: true, reopening: false };

test("start moves a status before the start status, or one outside the options, forward", () => {
  assert.equal(startStatusTarget({ ...base, current: "未着手" }), "進行中");
  assert.equal(startStatusTarget({ ...base, current: "inbox" }), "進行中");
});

test("start leaves the start status and later statuses alone", () => {
  assert.equal(startStatusTarget({ ...base, current: "進行中" }), null);
  assert.equal(startStatusTarget({ ...base, current: "レビュー" }), null);
  assert.equal(startStatusTarget({ ...base, current: "完了" }), null);
});

test("reopening moves any status back to the start status", () => {
  assert.equal(startStatusTarget({ ...base, current: "完了", reopening: true }), "進行中");
  assert.equal(startStatusTarget({ ...base, current: "進行中", reopening: true }), null);
});

test("without a start status, with the field disabled or an unknown start status, nothing moves", () => {
  assert.equal(startStatusTarget({ ...base, current: "未着手", startStatus: null }), null);
  assert.equal(startStatusTarget({ ...base, current: "未着手", statusFieldEnabled: false }), null);
  assert.equal(startStatusTarget({ ...base, current: "完了", statusFieldEnabled: false, reopening: true }), null);
  assert.equal(startStatusTarget({ ...base, current: "未着手", startStatus: "消えた状態" }), null);
});
