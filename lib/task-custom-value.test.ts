import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "./db";
import { equalTaskCustomValue, isEmptyTaskCustomValue, normalizeTaskCustomValue } from "./task-custom-value";
import { validateRuleDefinition } from "./automation/validate";

function queries(rows: Record<string, unknown>[][]): Queryable {
  return { query: async () => {
    const next = rows.shift();
    assert.ok(next, "unexpected lookup");
    return { rows: next, rowCount: next.length, command: "SELECT", fields: [], oid: 0 };
  } };
}

test("typed custom values reject malformed data instead of normalizing it to empty", async () => {
  for (const [field_type, value] of [
    ["people", "1,2"], ["reference", "3"], ["people", [1, "bad"]], ["reference", [0]],
    ["date", "2026-02-30"], ["date", "0000-01-01"], ["date", 20260101], ["number", true], ["multi_select", {}],
    ["text", undefined],
  ] as const) {
    assert.equal((await normalizeTaskCustomValue({ field_type }, value, 1, queries([]))).ok, false);
  }
  for (const field_type of ["auto_id", "formula", "lookup", "rollup", "project", "timer"]) {
    assert.equal((await normalizeTaskCustomValue({ field_type }, "overwrite", 1, queries([]))).ok, false);
  }
});

test("member and reference values validate all IDs and keep task editor display names", async () => {
  const people = await normalizeTaskCustomValue({ field_type: "people" }, [2, "1", 2], 1,
    queries([[{ id: 1, name: "One" }, { id: 2, name: "Two" }]]));
  assert.ok(people.ok);
  assert.deepEqual(people.value.value_json, [2, 1]);
  assert.equal(people.value.value_text, "Two, One");
  assert.equal((await normalizeTaskCustomValue({ field_type: "people" }, [5], 1, queries([[]]))).ok, false);

  const reference = { field_type: "reference", config: { source_project_ids: [4] } };
  const denied = await normalizeTaskCustomValue(reference, [8], 1, queries([[]]));
  assert.ok(!denied.ok);
  assert.equal(denied.status, 403);
  assert.equal((await normalizeTaskCustomValue(reference, [8], 1, queries([[{ id: 4 }], []]))).ok, false);
  const valid = await normalizeTaskCustomValue(reference, [8], 1,
    queries([[{ id: 4 }], [{ id: 8, name: "Source task" }]]));
  assert.ok(valid.ok);
  assert.equal(valid.value.value_text, "Source task");
});

test("normal empty values and comma multi-select stay compatible and equal typed values are no-ops", async () => {
  const multiple = await normalizeTaskCustomValue({ field_type: "multi_select" }, "Red, Blue", 1, queries([]));
  assert.ok(multiple.ok);
  assert.deepEqual(multiple.value.value_json, ["Red", "Blue"]);
  assert.equal(equalTaskCustomValue(multiple.value, multiple.value), true);
  for (const [field_type, value] of [["date", null], ["number", ""], ["people", []], ["reference", []]] as const) {
    const empty = await normalizeTaskCustomValue({ field_type }, value, 1, queries([]));
    assert.ok(empty.ok);
    assert.equal(isEmptyTaskCustomValue(empty.value), true);
    assert.equal(equalTaskCustomValue(undefined, empty.value), true);
  }
  const number = await normalizeTaskCustomValue({ field_type: "number" }, "12.5", 1, queries([]));
  assert.ok(number.ok);
  assert.equal(equalTaskCustomValue({ ...number.value, value_number: "12.5" as unknown as number }, number.value), true);
});

test("a custom-field rule requires an explicit value and supports intentional clearing", () => {
  const definition = (params: Record<string, unknown>) => ({
    triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.set_custom_field", params }],
  });
  assert.equal(validateRuleDefinition(definition({ field_id: 1 })).ok, false);
  assert.equal(validateRuleDefinition(definition({ field_id: 1, value: [] })).ok, true);
  assert.equal(validateRuleDefinition(definition({ field_id: 1, value: null })).ok, true);
});
