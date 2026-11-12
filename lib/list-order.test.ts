import { test } from "node:test";
import assert from "node:assert/strict";
import { orderByIds } from "./list-order";

test("manual order preserves current metadata, removes unavailable items and appends newcomers", () => {
  const items = [{ id: 1, name: "renamed" }, { id: 3, name: "third" }, { id: 4, name: "new" }];
  assert.deepEqual(orderByIds(items, [3, 2, 1]), [items[1], items[0], items[2]]);
  assert.equal(items[0].name, "renamed");
});

test("reconciling duplicate or empty order never hides or duplicates projects", () => {
  const items = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(orderByIds(items, [2, 2, 1]), [items[1], items[0]]);
  assert.deepEqual(orderByIds(items, []), items);
});
