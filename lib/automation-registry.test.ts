import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTION_CAPABILITIES,
  ACTION_DESCRIPTORS,
  ACTION_IDS,
  requiredActionParams,
} from "./automation/descriptors";

test("action ids are unique", () => {
  assert.equal(ACTION_IDS.size, ACTION_CAPABILITIES.length);
});

test("descriptors are derived from the capability registry", () => {
  assert.deepEqual(
    ACTION_DESCRIPTORS.map((action) => action.id),
    ACTION_CAPABILITIES.map((action) => action.id),
  );
});

test("required params are declared once per capability", () => {
  assert.deepEqual(requiredActionParams("task.set_custom_field"), ["field_id"]);
  assert.deepEqual(requiredActionParams("task.complete"), []);
  assert.deepEqual(requiredActionParams("unknown-capability"), []);
});

test("every required param is a declared action param name", () => {
  for (const action of ACTION_CAPABILITIES) {
    for (const param of action.requiredParams) {
      assert.match(param, /^[a-z][a-z0-9_]*$/);
    }
  }
});
