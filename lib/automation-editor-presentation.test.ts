import assert from "node:assert/strict";
import test from "node:test";
import { ruleValidationSummary } from "./automation/editor-presentation";

test("rule validation summary states the exact number of inputs to repair", () => {
  assert.equal(ruleValidationSummary(1), "公開前に 1 件の入力が必要です");
  assert.equal(ruleValidationSummary(2), "公開前に 2 件の入力が必要です");
  assert.equal(ruleValidationSummary(12), "公開前に 12 件の入力が必要です");
});
