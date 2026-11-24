import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskInputDraft, reconcileTaskInputDraft, type TaskInputSource } from "./task-input-draft";

const source: TaskInputSource = { taskId: 1, value: "Original", updatedAt: "2026-11-11 10:00:00.000001+09" };
const latest: TaskInputSource = { ...source, value: "Latest", updatedAt: "2026-11-11 10:00:00.000002+09" };

test("an untouched input follows refreshed values and preserves sub-millisecond lock stamps", () => {
  const result = reconcileTaskInputDraft(createTaskInputDraft(source), latest);
  assert.equal(result.value, "Latest");
  assert.equal(result.baseUpdatedAt, latest.updatedAt);
  assert.equal(reconcileTaskInputDraft(result, latest), result);
});

test("a dirty edit survives refresh with its original optimistic lock stamp", () => {
  const draft = { ...createTaskInputDraft(source), value: "Local draft" };
  const result = reconcileTaskInputDraft(draft, latest);
  assert.equal(result.value, "Local draft");
  assert.equal(result.baseValue, "Original");
  assert.equal(result.baseUpdatedAt, source.updatedAt);
  assert.equal(result.observedUpdatedAt, latest.updatedAt);
});

test("discard restores the conflict snapshot immediately while old server props remain", () => {
  const draft = { ...createTaskInputDraft(source), value: "Discard this" };
  const recovery = { ...source, recovery: { revision: 1, value: "Latest", updatedAt: latest.updatedAt } };
  const result = reconcileTaskInputDraft(draft, recovery);
  assert.equal(result.value, "Latest");
  assert.equal(result.baseValue, "Latest");
  assert.equal(result.baseUpdatedAt, latest.updatedAt);
  assert.equal(reconcileTaskInputDraft(result, recovery), result);
  const refreshed = reconcileTaskInputDraft(result, { ...latest, recovery: recovery.recovery });
  assert.equal(refreshed.value, "Latest");
  assert.equal(refreshed.baseValue, "Latest");
});

test("typing after discard survives the delayed refresh and uses the restored lock stamp", () => {
  const recovery = { ...source, recovery: { revision: 1, value: "Latest", updatedAt: latest.updatedAt } };
  const draft = { ...createTaskInputDraft(recovery), value: "A new intentional edit" };
  const result = reconcileTaskInputDraft(draft, { ...latest, recovery: recovery.recovery });
  assert.equal(result.value, "A new intentional edit");
  assert.equal(result.baseValue, "Latest");
  assert.equal(result.baseUpdatedAt, latest.updatedAt);
});

test("a refreshed saved value acknowledges the draft and advances its baseline", () => {
  const draft = { ...createTaskInputDraft(source), value: latest.value };
  const result = reconcileTaskInputDraft(draft, latest);
  assert.equal(result.value, result.baseValue);
  assert.equal(result.baseUpdatedAt, latest.updatedAt);
});

test("custom-field drafts follow remote values only while unedited", () => {
  const initial = { taskId: 42, value: "10", updatedAt: "stamp1" };
  const refreshed = { ...initial, value: "12", updatedAt: "stamp2" };
  const untouched = reconcileTaskInputDraft(createTaskInputDraft(initial), refreshed);
  assert.equal(untouched.value, "12");
  assert.equal(untouched.baseValue, "12");
  assert.equal(untouched.baseUpdatedAt, "stamp2");

  const dirty = { ...createTaskInputDraft(initial), value: "11" };
  const kept = reconcileTaskInputDraft(dirty, refreshed);
  assert.equal(kept.value, "11");
  assert.equal(kept.baseValue, "10");
  assert.equal(kept.baseUpdatedAt, "stamp1");
});

test("a repeated discard and changing tasks reset previous dirty drafts", () => {
  const recovering = { ...latest, recovery: { revision: 1, value: "Latest", updatedAt: latest.updatedAt } };
  const draft = { ...createTaskInputDraft(recovering), value: "Another stale attempt" };
  const next = reconcileTaskInputDraft(draft, { ...recovering, recovery: { revision: 2, value: "Newest", updatedAt: "stamp3" } });
  assert.equal(next.value, "Newest");
  assert.equal(next.baseUpdatedAt, "stamp3");
  const other = reconcileTaskInputDraft(next, { taskId: 2, value: "Other task", updatedAt: "stamp4" });
  assert.equal(other.value, "Other task");
  assert.equal(other.baseUpdatedAt, "stamp4");
});
