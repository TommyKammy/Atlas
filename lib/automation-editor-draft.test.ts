import test from "node:test";
import assert from "node:assert/strict";
import { ruleEditorDefinition, ruleEditorDraft, toggleRuleBranches } from "./automation/editor-draft";
import type { RuleAction, RuleDefinition } from "./automation/types";

const complete: RuleAction = { capability: "task.complete", params: {} };
const webhook: RuleAction = {
  capability: "webhook.post",
  webhookActionId: "00000000-0000-4000-8000-000000000001",
  params: { url: "https://example.com/hook" },
};

test("branch off/on retains every condition, else path and webhook identity", () => {
  const definition: RuleDefinition = {
    version: 1,
    triggers: [{ event: "task.created" }],
    branches: [
      { name: "conditional", conditions: [{ field: "task.name", op: "eq", value: "only this task" }], actions: [webhook] },
      { name: "fallback", conditions: [], else: true, actions: [complete] },
    ],
  };
  const initial = ruleEditorDraft({ name: "rule", description: "", definition });
  const flat = toggleRuleBranches(initial, complete);
  assert.equal(flat.useBranches, false);
  assert.equal(ruleEditorDefinition(flat).branches, undefined);
  const restored = toggleRuleBranches(flat, complete);
  assert.deepEqual(ruleEditorDefinition(restored).branches, definition.branches);
  assert.equal(initial.useBranches, true);
});

test("switching modes preserves independently edited flat and branch drafts", () => {
  const flat = ruleEditorDraft({ name: "rule", description: "", definition: {
    version: 1, triggers: [{ event: "task.created" }], actions: [complete],
  } });
  const branch = toggleRuleBranches(flat, webhook);
  branch.branches = [{ ...branch.branches[0], actions: [webhook] }];
  const flatAgain = toggleRuleBranches(branch, complete);
  assert.deepEqual(ruleEditorDefinition(flatAgain).actions, [complete]);
  const restored = toggleRuleBranches({ ...flatAgain, actions: [complete, complete] }, webhook);
  assert.deepEqual(ruleEditorDefinition(restored).branches?.[0].actions, [webhook]);
  assert.deepEqual(toggleRuleBranches(restored, complete).actions, [complete, complete]);
});

test("applying a flat AI definition replaces a branched draft completely", () => {
  const result = ruleEditorDraft({ name: "AI replacement", description: "new description", definition: {
    version: 1,
    triggers: [{ event: "task.completed" }],
    actions: [{ capability: "task.add_comment", params: { body: "AI body" } }],
  } });
  assert.equal(result.useBranches, false);
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.conditions, []);
  assert.deepEqual(ruleEditorDefinition(result), {
    version: 1, triggers: [{ event: "task.completed" }], conditions: [],
    actions: [{ capability: "task.add_comment", params: { body: "AI body" } }],
  });
});

test("applying a branched AI definition sets branch mode and keeps global conditions", () => {
  const definition: RuleDefinition = {
    version: 1, triggers: [{ event: "task.created" }],
    conditions: [{ field: "task.name", op: "contains", value: "review" }],
    branches: [{ name: "AI path", conditions: [], actions: [complete] }],
  };
  const draft = ruleEditorDraft({ name: "AI branch", description: "", definition });
  assert.equal(draft.useBranches, true);
  assert.deepEqual(ruleEditorDefinition(draft), definition);
});
