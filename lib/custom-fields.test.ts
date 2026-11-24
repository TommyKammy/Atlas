import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  customFieldInputKey,
  formatCustomFieldInputValue,
  type CustomField,
} from "./custom-fields";

const memoField: CustomField = {
  id: 5,
  name: "メモ",
  field_type: "text",
  options: [],
};

test("custom-field draft keys stay stable across server value changes", () => {
  assert.equal(customFieldInputKey(42, memoField.id), customFieldInputKey(42, memoField.id));
  assert.equal(customFieldInputKey(42, memoField.id), customFieldInputKey(42, memoField.id, 0));
  assert.notEqual(customFieldInputKey(42, memoField.id), customFieldInputKey(42, 6));
  assert.notEqual(customFieldInputKey(42, memoField.id), customFieldInputKey(43, memoField.id));
  assert.notEqual(customFieldInputKey(42, memoField.id), customFieldInputKey(42, memoField.id, 1));
});

test("custom-field attempt values use the existing display helpers", () => {
  const users = [{ id: 2, name: "佐藤" }, { id: 3, name: "鈴木" }];
  assert.equal(
    formatCustomFieldInputValue({ field_type: "people", config: {} }, [2, 3], users),
    "佐藤, 鈴木",
  );
  assert.equal(
    formatCustomFieldInputValue({ field_type: "reference", config: {} }, [4, 5], users),
    "ID:4, ID:5",
  );
  assert.equal(
    formatCustomFieldInputValue({ field_type: "multi_select", config: {} }, ["A", "B"], users),
    "A, B",
  );
  assert.equal(
    formatCustomFieldInputValue({ field_type: "date", config: {} }, "2026-11-24", users),
    "2026/11/24",
  );
  assert.equal(
    formatCustomFieldInputValue({ field_type: "number", config: {} }, 1200, users),
    "1,200",
  );
  assert.equal(formatCustomFieldInputValue({ field_type: "text", config: {} }, "", users), "–");
});

test("discarding a conflict remounts custom-field editors with refreshed values", () => {
  const pane = readFileSync(new URL("./use-task-pane.ts", import.meta.url), "utf8");
  const discard = pane.match(/const discardConflict = \(\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(discard, "discardConflict body not found");
  assert.match(discard, /setReloadRevision\(\(revision\) => revision \+ 1\)/);

  const taskPane = readFileSync(
    new URL("../components/TaskPane.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    taskPane,
    /<TaskCustomFieldsSection key=\{`fields-\$\{task\.id\}-\$\{reloadRevision\}`\}/,
  );
  const editorKeys = taskPane.match(/key=\{customFieldInputKey\(task\.id, field\.id, reloadRevision\)\}/g) ?? [];
  assert.equal(editorKeys.length, 3, "text, number and date editors keep a stable draft key");
});
