import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTriggerDays, SCHEDULED_TRIGGER_DEFAULTS } from "./automation/trigger-defaults";
import { validateRuleDefinition } from "./automation/validate";

test("scheduled trigger defaults are shared and unknown events have no default", () => {
  assert.equal(defaultTriggerDays("task.due_soon"), SCHEDULED_TRIGGER_DEFAULTS["task.due_soon"]);
  assert.equal(defaultTriggerDays("task.overdue"), SCHEDULED_TRIGGER_DEFAULTS["task.overdue"]);
  assert.equal(defaultTriggerDays("task.created"), undefined);
  assert.equal(defaultTriggerDays("constructor"), undefined);
});

test("saving an omitted due-soon day uses one and preserves an explicit zero", () => {
  for (const [trigger, expected] of [
    [{ event: "task.due_soon" }, 1],
    [{ event: "task.due_soon", days: 0 }, 0],
    [{ event: "task.overdue" }, 0],
  ] as const) {
    const result = validateRuleDefinition({
      triggers: [trigger],
      actions: [{ capability: "task.create", params: { name: "Follow-up" } }],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.definition.triggers[0].days, expected);
  }
});
