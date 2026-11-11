import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TaskSaveStatus from "../components/task/TaskSaveStatus";
import { taskSaveErrorMessage, updateTaskSaveState, type TaskSaveState } from "./task-save-state";

const state = (id: number, key: string, phase: TaskSaveState["phase"]): TaskSaveState => ({ id, key, phase, label: key === "name" ? "名前" : "進捗" });
const render = (states: Record<string, TaskSaveState>, reloading = false) => renderToStaticMarkup(createElement(TaskSaveStatus, { states, reloading, onReload: () => {} }));

test("task save states ignore late responses superseded by a newer request for the same fields", () => {
  const latest = { name: state(8, "name", "saved") };
  assert.equal(updateTaskSaveState(latest, state(7, "name", "failed")), latest);
  const pending = updateTaskSaveState(latest, state(9, "name", "saving"));
  assert.equal(pending.name.phase, "saving");
  assert.equal(updateTaskSaveState(pending, state(8, "name", "saved")), pending);
  const failed = updateTaskSaveState(pending, state(9, "name", "failed"));
  assert.equal(failed.name.phase, "failed");
  assert.equal(pending.name.phase, "saving", "previous state is immutable");
});

test("another field's successful save does not clear an existing unsaved error", () => {
  const failed = { name: { ...state(2, "name", "failed"), message: taskSaveErrorMessage(503) } };
  const updated = updateTaskSaveState(failed, state(3, "progress", "saved"));
  assert.equal(updated.name, failed.name);
  assert.equal(updated.progress.phase, "saved");
  const html = render(updated);
  assert.match(html, /data-task-save-status="failed"/);
  assert.match(html, /名前は未保存です/);
  assert.doesNotMatch(html, /data-task-save-status="saved"/);
});

test("retryable transport errors show retained input and field-specific recovery controls", () => {
  const html = render({ name: { ...state(1, "name", "failed"), message: taskSaveErrorMessage(503), retry: () => {} } });
  assert.match(html, /role="alert"/);
  assert.match(html, /入力内容は保持しています/);
  assert.match(html, /名前を再試行/);
  assert.match(html, /入力を破棄して最新表示/);
  for (const status of [null, 500, 503]) assert.match(taskSaveErrorMessage(status), /保存結果を確認できません/);
});

test("permission/session/deletion/validation errors explain recovery without claiming success", () => {
  assert.match(taskSaveErrorMessage(401), /再度ログイン/);
  assert.match(taskSaveErrorMessage(403), /編集権限.*入力内容は保持/);
  assert.match(taskSaveErrorMessage(404), /削除.*アクセス/);
  for (const status of [400, 422]) assert.match(taskSaveErrorMessage(status), /入力内容を確認/);
  const html = render({ name: { ...state(1, "name", "failed"), message: taskSaveErrorMessage(403) } });
  assert.match(html, /編集権限がありません/);
  assert.doesNotMatch(html, /名前を再試行/);
});

test("status priority preserves failure while another field saves and never labels a conflict as saved", () => {
  const html = render({ name: state(1, "name", "failed"), progress: state(2, "progress", "saving") });
  assert.match(html, /data-task-save-status="failed"/);
  assert.match(html, /ほかの変更を保存しています/);
  assert.match(html, /disabled=""/);
  assert.equal(render({ name: state(1, "name", "conflict") }), "");
  assert.match(render({ name: state(1, "name", "saving") }), /data-task-save-status="saving"/);
  assert.match(render({ name: state(1, "name", "saved") }), /data-task-save-status="saved"/);
  assert.equal(render({}), "");
});

test("explicit reload status remains visible until refreshed values arrive", () => {
  const html = render({ name: state(1, "name", "failed") }, true);
  assert.match(html, /data-task-save-status="loading"/);
  assert.match(html, /最新の状態を読み込んでいます/);
  assert.doesNotMatch(html, /名前を再試行/);
});
