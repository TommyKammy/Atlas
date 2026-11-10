import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionInputProblem, validConditionValue } from "./automation/condition-schema";
import { validateRuleDefinition } from "./automation/validate";
import type { ConditionOperator, RuleCondition } from "./automation/types";

const definition = (conditions: RuleCondition[] = []) => ({
  version: 1,
  triggers: [{ event: "task.completed" }],
  conditions,
  actions: [{ capability: "task.set_status", params: { status: "完了" } }],
});
const requiredOperators: ConditionOperator[] = ["eq", "neq", "contains", "not_contains", "in", "not_in", "gt", "gte", "lt", "lte"];
const emptyValues: unknown[] = [undefined, null, "", " \t\n", [], [""], ["review", " "], ["review", null], [undefined], [[[]]]];

test("value-taking operators reject all unfilled representations before publication", () => {
  for (const op of requiredOperators) {
    const field = ["gt", "gte", "lt", "lte"].includes(op) ? "task.progress" : "task.name";
    for (const value of emptyValues) {
      const condition: RuleCondition = { field, op, value };
      assert.equal(validConditionValue(condition), false, `${op}: ${JSON.stringify(value)}`);
      assert.match(conditionInputProblem(condition) ?? "", /比較する値を入力/);
      const result = validateRuleDefinition(definition([condition]));
      assert.equal(result.ok, false, `${op}: ${JSON.stringify(value)}`);
      if (!result.ok) assert.match(result.error, /共通の条件1:.*空である.*空でない/);
    }
  }
});

test("condition warnings distinguish unsupported operators and invalid typed values from missing input", () => {
  assert.match(conditionInputProblem({ field: "task.typo", op: "eq", value: "filled" }) ?? "", /項目を選択/);
  assert.match(conditionInputProblem({ field: "task.name", op: "gt", value: 2 }) ?? "", /比較方法を選んで/);
  for (const condition of [
    { field: "task.progress", op: "eq", value: "not numeric" },
    { field: "task.assignee_id", op: "eq", value: 0 },
    { field: "task.completed", op: "eq", value: "sometimes" },
    { field: "task.due_on", op: "eq", value: "2026-02-30" },
    { field: "task.name", op: "eq", value: {} },
  ] as RuleCondition[]) assert.match(conditionInputProblem(condition) ?? "", /値の形式/);
});

test("a descriptor type override cannot hide a missing or unknown condition field", () => {
  for (const field of ["", " ", "task.typo"]) {
    assert.match(conditionInputProblem({ field, op: "eq", value: "filled" }, "text") ?? "", /項目を選択/);
    assert.match(conditionInputProblem({ field, op: "is_empty" }, "text") ?? "", /項目を選択/);
  }
  const malformed = { op: "eq", value: "filled" } as RuleCondition;
  assert.match(conditionInputProblem(malformed) ?? "", /項目を選択/);
  assert.match(conditionInputProblem(malformed, "text") ?? "", /項目を選択/);
});

test("zero and false remain valid comparison values instead of being treated as unfilled", () => {
  for (const condition of [
    { field: "task.progress", op: "eq", value: 0 },
    { field: "task.progress", op: "gte", value: "0" },
    { field: "task.progress", op: "in", value: [0, "1"] },
    { field: "task.completed", op: "eq", value: false },
    { field: "task.completed", op: "neq", value: "false" },
    { field: "task.completed", op: "in", value: [false, true] },
    { field: "custom.Budget", op: "eq", value: 0 },
    { field: "event.data.accepted", op: "eq", value: false },
  ] as RuleCondition[]) {
    assert.equal(conditionInputProblem(condition), null, JSON.stringify(condition));
    assert.equal(validateRuleDefinition(definition([condition])).ok, true, JSON.stringify(condition));
  }
});

test("explicit emptiness operators require no value and keep unset assignee and custom-field rules expressible", () => {
  for (const op of ["is_empty", "is_not_empty"] as const) {
    for (const field of ["task.name", "task.assignee_id", "task.completed", "custom.Budget"]) {
      for (const value of emptyValues) {
        const condition: RuleCondition = { field, op, value };
        assert.equal(conditionInputProblem(condition), null);
        assert.equal(validateRuleDefinition(definition([condition])).ok, true);
      }
    }
  }
  assert.equal(validateRuleDefinition(definition([{ field: "task.assignee_id", op: "eq", value: null }])).ok, false);
});

test("all branch conditions are validated with their actual location, including otherwise branches", () => {
  for (const otherwise of [false, true]) {
    const result = validateRuleDefinition({ ...definition(), actions: [], branches: [
      { name: "valid", conditions: [], actions: [{ capability: "task.complete", params: {} }] },
      { name: "second", else: otherwise, conditions: [
        { field: "task.name", op: "contains", value: "review" },
        { field: "task.name", op: "eq", value: "" },
      ], actions: [{ capability: "task.complete", params: {} }] },
    ] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /^パス2の条件2: 比較する値を入力/);
  }
});

test("zero conditions remain a valid unconditional path, but a blank condition is not silently removed", () => {
  assert.equal(validateRuleDefinition(definition()).ok, true);
  const result = validateRuleDefinition(definition([{ field: "task.name", op: "eq", value: "" }]));
  assert.equal(result.ok, false);
  assert.equal(validateRuleDefinition({ ...definition(), actions: [], branches: [
    { name: "any", conditions: [], actions: [{ capability: "task.complete", params: {} }] },
  ] }).ok, true);
});

test("custom field input validation can use the resolved field type without changing action clearing semantics", () => {
  assert.equal(conditionInputProblem({ field: "custom.Budget", op: "eq", value: 0 }, "number"), null);
  assert.match(conditionInputProblem({ field: "custom.Budget", op: "eq", value: "not numeric" }, "number") ?? "", /値の形式/);
  assert.equal(conditionInputProblem({ field: "custom.Reviewers", op: "eq", value: [1, 2] }, "id_collection"), null);
  assert.match(conditionInputProblem({ field: "custom.Reviewers", op: "eq", value: [] }, "id_collection") ?? "", /比較する値を入力/);
  for (const value of [null, [], "", false, 0]) {
    assert.equal(validateRuleDefinition({ ...definition(), actions: [
      { capability: "task.set_custom_field", params: { field_id: 10, value } },
    ] }).ok, true, `clearing an action value: ${JSON.stringify(value)}`);
  }
});

test("deeply nested empty arrays fail input validation without recursive stack overflow", () => {
  let value: unknown = "";
  for (let depth = 0; depth < 5000; depth += 1) value = [value];
  assert.match(conditionInputProblem({ field: "event.data.payload", op: "eq", value }) ?? "", /比較する値を入力/);
});
