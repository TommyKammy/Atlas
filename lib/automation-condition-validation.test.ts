import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "./db";
import { validateRuleConditionScope } from "./automation/condition-validation";
import type { RuleCondition, RuleDefinition } from "./automation/types";

const fields = [
  { id: 10, name: "Budget", field_type: "number" },
  { id: 11, name: "Labels", field_type: "multi_select" },
  { id: 12, name: "Reviewers", field_type: "people" },
];
const q: Queryable = { query: async () => ({ rows: fields, rowCount: fields.length, command: "SELECT", fields: [], oid: 0 }) };
const definition = (condition: RuleCondition): RuleDefinition => ({
  version: 1, triggers: [{ event: "task.created" }],
  branches: [{ name: "condition", conditions: [condition], actions: [{ capability: "task.complete", params: {} }] }],
});

test("scoped custom conditions accept legacy names and numeric IDs with actual field types", async () => {
  for (const condition of [
    { field: "custom.10", op: "gt", value: "12.5" },
    { field: "custom.Budget", op: "is_empty" },
    { field: "custom.Labels", op: "contains", value: "Red" },
    { field: "custom.Labels", op: "eq", value: ["Red", "Blue"] },
    { field: "custom.Reviewers", op: "contains", value: "12" },
    { field: "custom.Reviewers", op: "eq", value: [1, 2] },
  ] as RuleCondition[]) {
    assert.deepEqual(await validateRuleConditionScope(definition(condition), { projectId: 1 }, 2, q), { ok: true });
  }
});

test("unknown, hidden and incompatible custom conditions are rejected in every branch", async () => {
  for (const condition of [
    { field: "custom.99", op: "eq", value: "hidden" },
    { field: "custom.10", op: "gt", value: "not numeric" },
    { field: "custom.10", op: "contains", value: "1" },
    { field: "custom.Labels", op: "eq", value: [1] },
    { field: "custom.Reviewers", op: "contains", value: "not an ID" },
  ] as RuleCondition[]) {
    assert.equal((await validateRuleConditionScope(definition(condition), { portfolioId: 1 }, 2, q)).ok, false);
  }
});
