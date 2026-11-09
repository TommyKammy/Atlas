import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTaskProjectIds } from "./api-project-auth";

test("orderTaskProjectIds keeps the default project first", () => {
  assert.deepEqual(
    orderTaskProjectIds({ defaultProjectId: 7, projectIds: [3, 7, 9] }),
    [7, 3, 9],
  );
});

test("orderTaskProjectIds does not duplicate the default project", () => {
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: 3, projectIds: [3] }), [3]);
});

test("orderTaskProjectIds handles tasks without a default project", () => {
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: null, projectIds: [4, 5] }), [4, 5]);
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: null, projectIds: [] }), []);
});
