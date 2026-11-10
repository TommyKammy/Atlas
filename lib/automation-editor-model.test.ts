import { test } from "node:test";
import assert from "node:assert/strict";
import { actionSummary, canonicalEditorDocument, conditionSummary, duplicateRuleAction, editorHistory, editorPayload, editorProblems, editorSignature, moveEditorItem, rebaseEditorCredentials, withEditorKeys, type RuleEditorDocument } from "./automation/editor-model";
import type { RuleDescriptors } from "./automation/descriptors";

const document: RuleEditorDocument = {
  name: "rule", description: "", enabled: true, triggers: [{ event: "task.created", filters: { section_id: 7 } }],
  conditions: [], actions: [{ capability: "task.complete", params: {} }],
  useBranches: true, branches: [{ name: "fallback", else: true, conditions: [], actions: [{
    capability: "webhook.post", webhookActionId: "00000000-0000-4000-8000-000000000001",
    params: { url: "https://example.com/private", secret: "secret-ref", body: "{{task.name}}" },
  }] }],
};

test("undo/redo preserves inactive mode data, trigger filters and webhook identities", () => {
  const original = structuredClone(document);
  let state = { past: [] as RuleEditorDocument[], present: original, future: [] as RuleEditorDocument[] };
  state = editorHistory(state, { type: "change", document: { ...original, useBranches: false } });
  assert.equal(editorPayload(state.present).definition.branches, undefined);
  state = editorHistory(state, { type: "undo" });
  assert.deepEqual(state.present, original);
  state = editorHistory(state, { type: "redo" });
  assert.equal(state.present.useBranches, false);
  assert.deepEqual(state.present.branches, original.branches);
  assert.deepEqual(state.present.triggers[0].filters, { section_id: 7 });
});

test("duplicated webhooks require new credentials and do not reuse signed references", () => {
  const original = document.branches[0].actions[0];
  const copy = duplicateRuleAction(original);
  assert.equal(copy.webhookActionId, undefined);
  assert.equal(copy.params.signing_secret, undefined);
  assert.equal(copy.params.secret, undefined);
  assert.equal(copy.params.url, "");
  assert.equal(copy.params.body, "{{task.name}}");
  assert.equal(original.params.secret, "secret-ref");
  copy.params.body = "changed";
  assert.equal(original.params.body, "{{task.name}}");
});

test("reordering is bounded and changes branch/action evaluation order without editing objects", () => {
  const actions = document.branches[0].actions;
  assert.equal(moveEditorItem(actions, 0, -1), actions);
  const list = [actions[0], document.actions[0]];
  assert.deepEqual(moveEditorItem(list, 1, -1), [list[1], list[0]]);
  assert.deepEqual(list, [actions[0], document.actions[0]]);
});

test("canvas summaries never expose webhook destinations or signing secrets", () => {
  const descriptors = { conditionFields: [], customFields: [], actions: [{ id: "webhook.post", params: [
    { name: "url", type: "text" }, { name: "secret", type: "password" }, { name: "body", type: "textarea" },
  ] }] } as unknown as RuleDescriptors;
  const summary = actionSummary(document.branches[0].actions[0], descriptors);
  assert.doesNotMatch(summary, /https:|private|secret-ref/);
  assert.match(summary, /送信先/);
});

test("server webhook identities rebase through concurrent edits, reordering and undo history", () => {
  let sequence = 0;
  const sent = withEditorKeys({ ...structuredClone(document), useBranches: false, actions: [document.branches[0].actions[0], document.actions[0]] }, () => `key-${sequence++}`);
  const response = { ...editorPayload(sent), definition: { version: 1 as const, triggers: sent.triggers, actions: [
    { capability: "webhook.post", webhookActionId: "00000000-0000-4000-8000-000000000099", params: { url: "https://example.com/private" } }, document.actions[0],
  ] } };
  const edited = { ...sent, name: "typed while saving", actions: [sent.actions[1], sent.actions[0]] };
  const rebased = rebaseEditorCredentials(edited, sent, response);
  assert.equal(rebased.name, "typed while saving");
  assert.equal(rebased.actions[1].webhookActionId, response.definition.actions[0].webhookActionId);
  assert.equal(rebased.actions[1].params.secret, undefined);
  assert.equal(rebased.actions[0].capability, "task.complete");
  const state = editorHistory({ past: [sent], present: edited, future: [] }, { type: "rebase", sent, saved: response });
  const undone = editorHistory(state, { type: "undo" });
  assert.equal(undone.present.actions[0].webhookActionId, response.definition.actions[0].webhookActionId);
  assert.equal(undone.present.actions[0].params.secret, undefined);
  assert.doesNotMatch(JSON.stringify(editorPayload(rebased)), /editorKey|key-/);
});

test("a secret typed after save started survives canonical reference adoption", () => {
  const sent = withEditorKeys({ ...document, useBranches: false, actions: [document.branches[0].actions[0]] });
  const edited = { ...sent, actions: [{ ...sent.actions[0], params: { ...sent.actions[0].params, secret: "a newer key" } }] };
  const saved = { ...editorPayload(sent), definition: { version: 1 as const, triggers: sent.triggers, actions: [{ capability: "webhook.post", webhookActionId: "00000000-0000-4000-8000-000000000099", params: { url: sent.actions[0].params.url } }] } };
  const result = rebaseEditorCredentials(edited, sent, saved);
  assert.equal(result.actions[0].params.secret, "a newer key");
  assert.equal(result.actions[0].webhookActionId, saved.definition.actions[0].webhookActionId);
});

test("JSONB property order does not dirty a saved document but action order does", () => {
  const before = { ...document, useBranches: false, actions: [{ capability: "task.create", params: { name: "x", project_id: 2 } }, document.actions[0]] };
  const after = { ...before, actions: [{ capability: "task.create", params: { project_id: 2, name: "x" } }, document.actions[0]] };
  assert.equal(editorSignature(before), editorSignature(after));
  assert.notEqual(editorSignature(before), editorSignature({ ...after, actions: [...after.actions].reverse() }));
});

test("a shared flat/branch action retains the published credential identity in both modes", () => {
  let key = 0;
  const sent = withEditorKeys({ ...document, actions: document.branches[0].actions }, () => `same-${key++}`);
  const saved = { ...editorPayload(sent), definition: { ...editorPayload(sent).definition, branches: [{ ...sent.branches[0], actions: [{ capability: "webhook.post", webhookActionId: "00000000-0000-4000-8000-000000000099", params: { url: sent.branches[0].actions[0].params.url } }] }] } };
  const result = canonicalEditorDocument(sent, saved);
  assert.equal(result.actions[0].webhookActionId, saved.definition.branches[0].actions[0].webhookActionId);
  assert.equal(result.branches[0].actions[0].webhookActionId, result.actions[0].webhookActionId);
});

test("incomplete common and branch conditions identify the exact editor location", () => {
  const input: RuleEditorDocument = { ...document, conditions: [{ field: "task.name", op: "eq", value: "" }],
    branches: [{ name: "担当者あり", conditions: [{ field: "task.status", op: "in", value: ["進行中", " "] }], actions: document.actions }] };
  const problems = editorProblems(input);
  assert.equal(problems.length, 2);
  assert.deepEqual(problems.map(({ selection, conditionIndex }) => ({ selection, conditionIndex })), [
    { selection: { kind: "conditions" }, conditionIndex: 0 },
    { selection: { kind: "branch", index: 0 }, conditionIndex: 0 },
  ]);
  assert.match(problems[0].label, /共通の条件 1/);
  assert.match(problems[1].label, /担当者ありの条件 1/);
  assert.match(problems[0].label, /空である/);
});

test("zero, false, explicit emptiness and no conditions remain publishable", () => {
  for (const conditions of [[], [{ field: "task.progress", op: "eq" as const, value: 0 }],
    [{ field: "task.completed", op: "eq" as const, value: false }],
    [{ field: "task.name", op: "is_empty" as const }], [{ field: "task.name", op: "is_not_empty" as const }]]) {
    assert.deepEqual(editorProblems({ ...document, useBranches: false, conditions }), []);
  }
});

test("inactive branch mode does not block a flat workflow but retained fallback conditions are checked", () => {
  const branches = [{ name: "それ以外", else: true, conditions: [{ field: "task.name", op: "eq" as const, value: "" }], actions: document.actions }];
  assert.deepEqual(editorProblems({ ...document, useBranches: false, branches }), []);
  assert.equal(editorProblems({ ...document, useBranches: true, branches })[0].conditionIndex, 0);
});

test("empty condition summaries show an actionable marker instead of empty quotes", () => {
  const descriptors = { conditionFields: [{ id: "task.name", label: "タスク名" }], customFields: [], operators: [{ value: "eq", label: "等しい" }] } as unknown as RuleDescriptors;
  assert.equal(conditionSummary({ field: "task.name", op: "eq", value: "" }, descriptors), "タスク名 等しい［入力を確認］");
});
