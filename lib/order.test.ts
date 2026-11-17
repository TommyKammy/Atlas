import assert from "node:assert/strict";
import { test } from "node:test";
import { positionBetween, spaceTaskRanks } from "./order";

test("fractional positions stay strictly inside the gap, including at either end", () => {
  assert.equal(positionBetween(null, 0), -1000);
  assert.equal(positionBetween(1000, 1125), 1062.5);
  assert.equal(positionBetween(0, null), 1000);
  assert.equal(positionBetween(1, 1 + Number.EPSILON), null);
  assert.equal(positionBetween(Number.MAX_VALUE, null), null);
});

test("only a crowded window is spaced, preserving the existing tie-break order", () => {
  const rows = [0, 300, 300, 600, 8000].map((position, id) => ({ id, position }));
  const result = spaceTaskRanks(rows, 2, 9);
  assert.deepEqual(result, [{ id: 1, position: 150 }, { id: 9, position: 300 }, { id: 2, position: 450 }]);
});

test("equal extreme ranks still have room for insertion at the head or tail", () => {
  for (const position of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const rows = [1, 2, 3, 4].map(id => ({ id, position }));
    for (const index of [0, 2, 4]) {
      const result = spaceTaskRanks(rows, index, 9);
      const order = rows.map(row => row.id);
      order.splice(index, 0, 9);
      const ranks = new Map(rows.map(row => [row.id, row.position]));
      for (const row of result) ranks.set(row.id, row.position);
      assert.ok(order.every((id, i) => Number.isFinite(ranks.get(id)) &&
        (i === 0 || ranks.get(order[i - 1])! < ranks.get(id)!)));
    }
  }
});
