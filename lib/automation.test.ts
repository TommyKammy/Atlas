import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRuleDefinition } from "./automation/validate";

test("validateRuleDefinition accepts multiple triggers and actions", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.created" }, { event: "task.completed" }],
    conditions: [{ field: "task.status", op: "eq", value: "進行中" }],
    actions: [
      { capability: "task.set_status", params: { status: "完了" } },
      { capability: "task.add_comment", params: { body: "done" } },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.triggers.length, 2);
    assert.equal(result.definition.actions?.length, 2);
    assert.equal(result.definition.version, 1);
  }
});

test("validateRuleDefinition enforces required structure and limits", () => {
  assert.equal(validateRuleDefinition({ triggers: [], actions: [] }).ok, false);
  assert.equal(
    validateRuleDefinition({
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "unknown.capability", params: {} }],
    }).ok,
    false,
  );
  const tooMany = Array.from({ length: 21 }, () => ({ event: "task.created" as const }));
  assert.equal(
    validateRuleDefinition({
      triggers: tooMany,
      actions: [{ capability: "task.complete", params: {} }],
    }).ok,
    false,
  );
  assert.equal(
    validateRuleDefinition({
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "task.complete", params: {} }],
      conditions: [{ field: "task.name", op: "bogus" as never, value: "x" }],
    }).ok,
    false,
  );
});

test("validateRuleDefinition rejects missing required action parameters", () => {
  const result = validateRuleDefinition({
    triggers: [{ event: "task.created" }],
    actions: [{ capability: "task.add_comment", params: { body: "" } }],
  });
  assert.equal(result.ok, false);
});

test("validateRuleDefinition supports branches and else paths", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.created" }],
    branches: [
      {
        name: "high",
        conditions: [{ field: "task.name", op: "contains", value: "urgent" }],
        actions: [{ capability: "task.assign", params: { user_id: 1 } }],
      },
      {
        name: "fallback",
        else: true,
        conditions: [],
        actions: [{ capability: "task.add_comment", params: { body: "fallback" } }],
      },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.definition.branches?.length, 2);
});

test("validateRuleDefinition accepts milestone trigger and condition", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.milestone_changed" }],
    conditions: [{ field: "task.is_milestone", op: "eq", value: "true" }],
    actions: [{ capability: "task.add_comment", params: { body: "milestone" } }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.triggers[0].event, "task.milestone_changed");
    assert.equal(result.definition.conditions?.[0].field, "task.is_milestone");
  }
});

test("validateRuleDefinition accepts scheduled date triggers", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.overdue", days: 2 }],
    actions: [{ capability: "task.add_comment", params: { body: "overdue" } }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.definition.triggers[0].days, 2);
});
