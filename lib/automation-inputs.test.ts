import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuleDescriptors } from "./automation/descriptors";
import { CONDITION_OPERATORS, RULE_LIMITS } from "./automation/types";
import {
  changeRuleActionCapability, changeRuleCondition, compatibleRuleVariables, conditionUsesArray,
  insertRuleVariable, parseRuleOptionQuery, ruleCollectionValues, ruleConditionOperators, ruleVariables, updateRuleActionParam,
} from "./automation/no-code-inputs";
import { validateRuleDefinition } from "./automation/validate";

const descriptors: RuleDescriptors = {
  triggers: [], actions: [], limits: RULE_LIMITS, operators: CONDITION_OPERATORS,
  conditionFields: [
    { id: "task.name", label: "タスク名", type: "text", group: "タスク" },
    { id: "task.completed", label: "完了", type: "boolean", group: "タスク" },
    { id: "custom.1", label: "予算", type: "number", group: "カスタムフィールド", valueType: "number" },
    { id: "custom.2", label: "レビュアー", type: "text", group: "カスタムフィールド", valueType: "id_collection" },
  ],
  customFields: [
    { id: 1, name: "予算", field_type: "number", options: [] },
    { id: 2, name: "レビュアー", field_type: "people", options: [] },
  ],
};

test("option requests are bounded and cannot interpret malformed IDs or unknown search kinds", () => {
  for (const query of ["kind=sql", "kind=task&ids=", "kind=task&ids=1,2%20OR%201=1", "kind=task&ids=1.5", "kind=task&ids=1e2", "kind=reference", "kind=reference&field_id=-1", `kind=task&ids=${Array.from({ length: 51 }, (_, index) => index + 1).join(",")}`]) {
    assert.equal(parseRuleOptionQuery(new URLSearchParams(query)).ok, false);
  }
  const parsed = parseRuleOptionQuery(new URLSearchParams({ kind: "task", q: "x".repeat(150), ids: "2,2,3" }));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.ids, [2, 3]);
  assert.equal(parsed.value.query.length, 100);
});

test("ordinary action edits preserve redacted credential references while explicit capability changes clear them", () => {
  const action = { capability: "webhook.post", webhookActionId: "reference", params: { url: "https://example.com/hook" } };
  const edited = updateRuleActionParam(action, "url", "https://example.com/new");
  assert.equal(edited.webhookActionId, "reference");
  assert.equal(Object.hasOwn(edited.params, "secret"), false);
  assert.equal(changeRuleActionCapability(action, "webhook.post"), action);
  assert.deepEqual(changeRuleActionCapability(action, "task.complete"), { capability: "task.complete", params: {} });
  const values = [2, 3];
  const field = { capability: "task.set_custom_field", params: { field_id: "2", value: values } };
  assert.equal(updateRuleActionParam(field, "field_id", 2).params.value, values);
  assert.equal(Object.hasOwn(updateRuleActionParam(field, "field_id", 1).params, "value"), false);
});

test("variable insertion preserves text cursors and typed custom-field representations", () => {
  const variables = ruleVariables(descriptors);
  const name = variables.find((variable) => variable.path === "task.name")!;
  const number = variables.find((variable) => variable.path === "custom.1")!;
  const member = variables.find((variable) => variable.path === "task.assignee_id")!;
  assert.equal(insertRuleVariable("前後", name, "text", 1, 1), "前{{task.name}}後");
  assert.equal(insertRuleVariable(12, number, "number"), "{{custom.1}}");
  const ids = [4, 5];
  assert.deepEqual(insertRuleVariable(ids, member, "id_collection"), [4, 5, "{{task.assignee_id}}"]);
  assert.deepEqual(ids, [4, 5]);
  assert.ok(!compatibleRuleVariables(variables, "number").some((variable) => variable.path === "task.name"));
  assert.ok(compatibleRuleVariables(variables, "number").some((variable) => variable.path === "custom.1"));
  assert.ok(!variables.some((variable) => variable.path.includes("secret")));
  const definition = {
    version: 1, triggers: [{ event: "task.manual_rule" }], actions: [{
      capability: "task.set_custom_field", params: { field_id: 2, value: insertRuleVariable(ids, member, "id_collection") },
    }],
  };
  assert.equal(validateRuleDefinition(definition).ok, true);
});

test("field-dependent conditions use server-compatible operators and preserve v1 collection literals", () => {
  assert.ok(!ruleConditionOperators("task.completed", descriptors).some((operator) => operator.value === "contains"));
  assert.ok(ruleConditionOperators("custom.1", descriptors).some((operator) => operator.value === "gt"));
  const condition = { field: "custom.2", op: "eq" as const, value: [2] };
  assert.equal(conditionUsesArray(condition, descriptors), true);
  assert.equal(conditionUsesArray({ ...condition, op: "contains" }, descriptors), false);
  assert.deepEqual(changeRuleCondition(condition, condition.field, "is_empty", descriptors), { field: "custom.2", op: "is_empty" });
  assert.equal(changeRuleCondition(condition, condition.field, "eq", descriptors), condition);
  assert.deepEqual(ruleCollectionValues("one,two", { scalar: true }), ["one,two"]);
  assert.deepEqual(ruleCollectionValues("one, two", { commaSeparated: true }), ["one", "two"]);
  assert.deepEqual(ruleCollectionValues(2, { scalar: true }), [2]);
});
