import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import type { Queryable } from "../db";
import { enableDevProjectTx } from "./dev-projects";

function queryable(handler: (sql: string, params: unknown[]) => unknown): { q: Queryable; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const q: Queryable = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push(params);
      const rows = handler(sql, params) as Record<string, unknown>[];
      return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
    },
  };
  return { q, calls };
}

test("enableDevProjectTx normalizes the prefix and passes the start status through", async () => {
  const { q, calls } = queryable(() => [{ namespace_id: 7, keyed: 3 }]);
  const enabled = await enableDevProjectTx(q, 42, { prefix: " atl ", start_status: "進行中" }, 5);
  assert.deepEqual(calls, [[42, "ATL", "進行中", 5, 20_000]]);
  assert.deepEqual(enabled, {
    namespaceId: 7, prefix: "ATL", branchPrefix: "atl", startStatus: "進行中", keyed: 3,
  });
});

test("enableDevProjectTx rejects bad input before touching the database", async () => {
  const { q, calls } = queryable(() => []);
  await assert.rejects(enableDevProjectTx(q, 1, { prefix: "A" }, 1), (e) => e instanceof ApiError && e.status === 400);
  await assert.rejects(
    enableDevProjectTx(q, 1, { prefix: "ATL", start_status: 3 }, 1),
    (e) => e instanceof ApiError && e.status === 400,
  );
  assert.equal(calls.length, 0);
});

test("database errors from atlas_enable_dev_project map to API errors", async () => {
  const cases: [string, number][] = [["DK404", 404], ["DK409", 409], ["DK413", 409], ["DK422", 400], ["23505", 409]];
  for (const [code, status] of cases) {
    const { q } = queryable(() => {
      throw Object.assign(new Error(code), { code });
    });
    await assert.rejects(
      enableDevProjectTx(q, 1, { prefix: "ATL" }, 1),
      (e) => e instanceof ApiError && e.status === status,
      code,
    );
  }
  const { q } = queryable(() => {
    throw Object.assign(new Error("boom"), { code: "XX000" });
  });
  await assert.rejects(enableDevProjectTx(q, 1, { prefix: "ATL" }, 1), { message: "boom" });
});
