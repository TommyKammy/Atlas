import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMyTaskMove, MY_TASK_LEGACY_ITEM_LIMIT, MY_TASK_MOVE_TASK_LIMIT,
  myTaskOrderEqual, parseMyTaskOrderRequest, parseMyTaskSnapshot,
} from "./my-task-order";

test("relative moves preserve every other task's order for near/far/end targets", () => {
  const ids = Array.from({ length: 501 }, (_, index) => index + 1);
  assert.deepEqual(applyMyTaskMove(ids, { task_id: 2, before_task_id: 1 }).slice(0, 4), [2, 1, 3, 4]);
  const far = applyMyTaskMove(ids, { task_id: 1, after_task_id: 501 });
  assert.deepEqual(far, [...ids.slice(1), 1]);
  assert.deepEqual(applyMyTaskMove(ids, { task_id: 1 }), far);
  assert.deepEqual(applyMyTaskMove(ids, { task_id: 501, before_task_id: 1 }), [501, ...ids.slice(0, -1)]);
  assert.equal(ids[0], 1, "the caller's order is never mutated");
});

test("no-op relative moves are detectable without rewriting any positions", () => {
  assert.ok(myTaskOrderEqual([1, 2, 3], applyMyTaskMove([1, 2, 3], { task_id: 2, before_task_id: 3 })));
  assert.ok(myTaskOrderEqual([1, 2, 3], applyMyTaskMove([1, 2, 3], { task_id: 3 })));
  assert.ok(!myTaskOrderEqual([1, 2], [2, 1]));
  assert.ok(!myTaskOrderEqual([1], [1, 2]));
});

test("relative move rejects missing/deleted/reassigned source or anchor snapshots", () => {
  assert.throws(() => applyMyTaskMove([1, 2], { task_id: 3, before_task_id: 1 }), /eligibility changed/);
  assert.throws(() => applyMyTaskMove([1, 2], { task_id: 1, before_task_id: 3 }), /eligibility changed/);
});

test("new move DTO remains constant-sized beyond the legacy 500-item limit", () => {
  assert.equal(MY_TASK_LEGACY_ITEM_LIMIT, 500);
  assert.equal(MY_TASK_MOVE_TASK_LIMIT, 10_000);
  assert.deepEqual(parseMyTaskOrderRequest({ move: { task_id: 1, after_task_id: 501 } }), {
    ok: true, value: { kind: "move", move: { task_id: 1, after_task_id: 501 } },
  });
  const legacy = Array.from({ length: 501 }, (_, index) => ({ task_id: index + 1, position: index }));
  assert.equal(parseMyTaskOrderRequest({ items: legacy }).ok, false);
});

test("legacy date snapshots are optional assertions and strict calendar dates", () => {
  assert.deepEqual(parseMyTaskOrderRequest({ items: [{ task_id: 1, position: 1 }] }), {
    ok: true, value: { kind: "items", items: [{ task_id: 1, position: 1 }] },
  });
  assert.equal(parseMyTaskOrderRequest({ items: [{ task_id: 1, position: 0, due_on: null }] }).ok, true);
  assert.equal(parseMyTaskOrderRequest({ items: [{ task_id: 1, position: 1.5, due_on: "2024-02-29" }] }).ok, true);
  for (const due_on of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-1", "0000-01-01", 1]) {
    assert.equal(parseMyTaskOrderRequest({ items: [{ task_id: 1, position: 1, due_on }] }).ok, false);
  }
});

test("order DTO rejects mixed payloads, duplicate IDs, state mutations and ambiguous anchors", () => {
  for (const body of [
    null, [], {}, { items: [] },
    { move: { task_id: 1 }, items: [] },
    { move: { task_id: 1, before_task_id: 2, after_task_id: 3 } },
    { move: { task_id: 1, before_task_id: 1 } },
    { move: { task_id: 1, after_task_id: 1 } },
    { move: { task_id: 1, completed: true } },
    { move: { task_id: 1, due_on: null } },
    { move: { task_id: "1" } },
    { items: [{ task_id: 1, position: 1 }, { task_id: 1, position: 2 }] },
    { items: [{ task_id: 1, position: Infinity }] },
    { items: [{ task_id: 1, position: Number.MAX_VALUE }] },
    { items: [{ task_id: 1, position: null }] },
    { items: [{ task_id: 1, position: 1, completed: true }] },
  ]) assert.equal(parseMyTaskOrderRequest(body).ok, false, JSON.stringify(body));
});

test("snapshot keeps date, order and exact optimistic stamp together", () => {
  const items = [
    { task_id: 2, due_on: "2026-11-11", updated_at: "2026-11-11 12:34:56.123456+00" },
    { task_id: 1, due_on: null, updated_at: "2026-11-11 12:34:57.123456+00" },
  ];
  assert.deepEqual(parseMyTaskSnapshot({ items, overflow: false }), { items, overflow: false });
  for (const body of [
    {}, { items, overflow: "false" },
    { items: [items[0], items[0]], overflow: false },
    { items: [{ ...items[0], updated_at: "" }], overflow: false },
    { items: [{ ...items[0], due_on: "2026-02-30" }], overflow: false },
  ]) assert.throws(() => parseMyTaskSnapshot(body), /invalid My Tasks snapshot/);
});
