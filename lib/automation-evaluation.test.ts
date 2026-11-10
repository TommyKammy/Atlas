import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRule, historyRuleEvaluation, matchRuleCondition, renderRuleActions, ruleTriggersMatch, type RuleSnapshot } from "./automation/evaluation";
import { previewResponse } from "./automation/preview";
import { previewEvent } from "./automation/preview-event";
import type { RuleCondition, RuleDefinition } from "./automation/types";

const snapshot: RuleSnapshot = {
  task: { id: 12, name: "Review", completed: false, progress: 25, due_on: "2026-11-10", description: "", project_id: 3 },
  project: { id: 3, name: "Project" }, custom: { Labels: ["Red", "Blue"], Budget: 12.5 },
  event: { id: 1, workspace_id: 1, project_id: 3, actor_id: 2, type: "task.created", version: 1,
    subject_type: "task", subject_id: 12, data: { flag: "yes" }, correlation_id: null, causation_id: null,
    chain_depth: 0, occurred_at: "2026-11-10T00:00:00Z", attempts: 1 },
};
const definition = (extra: Partial<RuleDefinition> = {}): RuleDefinition => ({
  version: 1, triggers: [{ event: "task.created" }],
  actions: [{ capability: "task.create", params: { name: "{{task.name}} / {{project.name}}" } }], ...extra,
});

test("shared condition matcher preserves boolean, numeric, date, collection and empty semantics", () => {
  const conditions: RuleCondition[] = [
    { field: "task.completed", op: "eq", value: "false" }, { field: "task.progress", op: "eq", value: "25" },
    { field: "task.progress", op: "gt", value: 24 }, { field: "task.progress", op: "gte", value: 25 },
    { field: "task.progress", op: "lt", value: 26 }, { field: "task.progress", op: "lte", value: 25 },
    { field: "task.due_on", op: "gte", value: "2026-11-09" }, { field: "task.name", op: "contains", value: "view" },
    { field: "custom.Labels", op: "contains", value: "Red" }, { field: "custom.Labels", op: "not_contains", value: "Green" },
    { field: "task.name", op: "in", value: ["Review", "Other"] }, { field: "task.name", op: "not_in", value: ["Other"] },
    { field: "task.description", op: "is_empty" }, { field: "custom.Budget", op: "is_not_empty" },
    { field: "task.name", op: "neq", value: "Other" },
  ];
  for (const condition of conditions) assert.equal(matchRuleCondition(condition, snapshot), true, JSON.stringify(condition));
  assert.equal(matchRuleCondition({ field: "task.progress", op: "lt", value: 20 }, snapshot), false);
});

test("trigger target/filter checks and first matching branch share the runner's exact ordering", () => {
  assert.equal(ruleTriggersMatch(definition({ triggers: [{ event: "task.created", filters: { flag: "yes" } }] }), snapshot.event), true);
  assert.equal(ruleTriggersMatch(definition(), { ...snapshot.event, data: { target_rule_id: 7 } }, 8), false);
  const result = evaluateRule(definition({ branches: [
    { name: "else declared first", else: true, conditions: [], actions: [{ capability: "task.complete", params: {} }] },
    { name: "not matched", conditions: [{ field: "task.name", op: "eq", value: "Other" }], actions: [] },
    { name: "matched", conditions: [{ field: "task.name", op: "eq", value: "Review" }], actions: [{ capability: "task.add_comment", params: { body: "{{custom.Budget}}" } }] },
    { name: "later match", conditions: [], actions: [{ capability: "task.complete", params: {} }] },
  ] }), snapshot);
  assert.equal(result.trace.selected_branch, 2);
  assert.equal(result.trace.branches[0].evaluated, false);
  assert.equal(result.trace.branches[1].matched, false);
  assert.equal(result.trace.branches[3].evaluated, false);
  assert.equal(result.actions[0].params.body, "12.5");
  const fallback = evaluateRule(definition({ branches: [
    { name: "not matched", conditions: [{ field: "task.name", op: "eq", value: "Other" }], actions: [] },
    { name: "fallback", else: true, conditions: [], actions: [{ capability: "task.complete", params: {} }] },
  ] }), snapshot);
  assert.equal(fallback.trace.selected_branch, 1);
  assert.equal(fallback.trace.branches[1].selected, true);
});

test("unmatched global conditions show skipped evaluation and no actions", () => {
  const result = evaluateRule(definition({ conditions: [
    { field: "task.name", op: "eq", value: "Other" }, { field: "task.progress", op: "gt", value: 0 },
  ], branches: [{ name: "path", conditions: [], actions: [{ capability: "task.complete", params: {} }] }] }), snapshot);
  assert.equal(result.trace.matched, false);
  assert.equal(result.trace.conditions[1].evaluated, false);
  assert.equal(result.trace.branches[0].evaluated, false);
  assert.deepEqual(result.actions, []);
});

test("template expansion recurses without changing typed clears or explicit project destinations", () => {
  const actions = renderRuleActions([
    { capability: "task.create", params: { name: "{{task.name}}", project_id: 9, task_id: 999, nested: ["{{event.data.flag}}", null, 12] } },
  ], snapshot);
  assert.deepEqual(actions[0].params, { name: "Review", project_id: 9, task_id: 12, nested: ["yes", null, 12] });
  const project = { ...snapshot, task: null, event: { ...snapshot.event, type: "project.status_changed" as const, subject_type: "project", subject_id: 3 } };
  assert.equal(renderRuleActions([{ capability: "task.complete", params: { task_id: "19" } }], project)[0].params.task_id, 19);
  assert.equal(Object.hasOwn(renderRuleActions([{ capability: "task.complete", params: { task_id: "{{event.subject_id}}" } }], project)[0].params, "task_id"), false);
});

test("history keeps decisions without values while preview redacts supplied webhook credentials", () => {
  const result = evaluateRule(definition({ conditions: [{ field: "task.name", op: "eq", value: "Review" }], actions: [
    { capability: "webhook.post", params: { url: "https://user:private-password@example.com/hook?token=private-token", secret: "private-signing-key" } },
  ] }), snapshot);
  const history = historyRuleEvaluation(result.trace);
  assert.equal(Object.hasOwn(history.conditions[0], "actual"), false);
  assert.equal(Object.hasOwn(history.conditions[0], "value"), false);
  assert.equal(history.conditions[0].matched, true);
  assert.equal(result.trace.conditions[0].actual, "Review", "redaction must not mutate the evaluator");
  const response = previewResponse(result.trace, result.actions, []);
  assert.deepEqual(response.actions[0].params, {});
  assert.ok(!JSON.stringify(response).includes("private-"));
});

test("preview requires an explicit typed mock event and warns about current-state differences", () => {
  const context = { projectId: 3, workspaceId: 1, actorId: 2 };
  for (const event of [null, {}, { type: "unknown" }, { type: "task.created" },
    { type: "task.created", task_id: 12, data: [] }, { type: "task.due_changed", task_id: 12, data: { due_on: "2026-02-30" } },
    { type: "task.milestone_changed", task_id: 12, data: { is_milestone: "false" } }, { type: "project.status_changed", task_id: 12 },
    { type: "task.created", task_id: 12, subject_id: 999 },
  ]) assert.equal(previewEvent(event, context).ok, false, JSON.stringify(event));
  const event = previewEvent({ type: "task.status_changed", task_id: 12 }, context);
  assert.ok(event.ok);
  assert.equal(event.event.subject_id, 12);
  assert.ok(event.warnings.some((warning) => warning.includes("status")));
  assert.equal(previewEvent({ type: "webhook.received", data: { status: 200, payload: [1, 2] } }, context).ok, true);
});
