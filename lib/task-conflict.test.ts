import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCustomFieldConflict, taskConflictComparisonRows } from "./task-conflict";

const describeValue = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === "") return "–";
  if (key === "completed") return value === true ? "完了" : "未完了";
  return String(value);
};

test("the custom_field section of a 409 becomes a conflict with its current value", () => {
  const conflict = parseCustomFieldConflict({
    field_id: 5,
    name: "見積",
    field_type: "number",
    config: { number_format: "number", decimals: 0 },
    value: { value_text: null, value_number: 1200, value_date: null, value_json: null },
  }, 1500);

  assert.ok(conflict);
  assert.equal(conflict.fieldId, 5);
  assert.equal(conflict.name, "見積");
  assert.equal(conflict.fieldType, "number");
  assert.deepEqual(conflict.config, { number_format: "number", decimals: 0 });
  assert.deepEqual(conflict.current, {
    value_text: null,
    value_number: 1200,
    value_date: null,
    value_json: null,
  });
  assert.equal(conflict.attempted, 1500);
});

test("custom-field conflicts appear in the comparison with label and both values", () => {
  const customField = parseCustomFieldConflict({
    field_id: 5,
    name: "メモ",
    field_type: "text",
    config: null,
    value: { value_text: "現在値", value_number: null, value_date: null, value_json: null },
  }, "入力値");
  assert.ok(customField);

  const rows = taskConflictComparisonRows({
    attempted: { name: "入力名", "cf-5": "入力値" },
    current: { name: "現在名" },
    customField,
    labels: { name: "名前" },
    describeValue,
    users: [],
  });

  assert.deepEqual(rows.map((row) => row.key), ["name", "cf-5"]);
  assert.deepEqual(rows[0], {
    key: "name",
    label: "名前",
    attempted: "入力名",
    current: "現在名",
  });
  assert.deepEqual(rows[1], {
    key: "cf-5",
    label: "メモ",
    attempted: "入力値",
    current: "現在値",
  });
});

test("an unrenderable conflict has no comparison rows", () => {
  const rows = taskConflictComparisonRows({
    attempted: { "cf-5": "入力値" },
    current: {},
    labels: { name: "名前" },
    describeValue,
    users: [],
  });
  assert.deepEqual(rows, []);
});

test("an absent custom_field payload cannot create a custom-field row", () => {
  const rows = taskConflictComparisonRows({
    attempted: { "cf-5": "入力値" },
    current: {},
    customField: parseCustomFieldConflict(null, "入力値"),
    labels: { name: "名前" },
    describeValue,
    users: [],
  });
  assert.deepEqual(rows, []);
});

test("the overwrite action is only rendered when a comparison exists", () => {
  const pane = readFileSync(
    new URL("../components/TaskPane.tsx", import.meta.url),
    "utf8",
  );
  assert.match(pane, /\{conflictRows\.length > 0 && \(/);
});
