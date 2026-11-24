import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { customFieldInputKey, type CustomField, type CustomValue } from "./custom-fields";

const memoField: CustomField = {
  id: 5,
  name: "メモ",
  field_type: "text",
  options: [],
};

function memo(value: string): CustomValue {
  return { value_text: value, value_number: null };
}

test("custom-field input keys change when the server value changes", () => {
  assert.notEqual(
    customFieldInputKey(42, memoField, memo("自動化あり")),
    customFieldInputKey(42, memoField, memo("古い画面から")),
  );
  assert.equal(
    customFieldInputKey(42, memoField, memo("自動化あり")),
    customFieldInputKey(42, memoField, memo("自動化あり")),
  );
  assert.notEqual(
    customFieldInputKey(42, { ...memoField, id: 6 }, memo("自動化あり")),
    customFieldInputKey(42, memoField, memo("自動化あり")),
  );
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
  const editorKeys = taskPane.match(/key=\{customFieldInputKey\(task\.id, field, value\)\}/g) ?? [];
  assert.equal(editorKeys.length, 4, "text, number, date and select editors remount on value changes");
});
