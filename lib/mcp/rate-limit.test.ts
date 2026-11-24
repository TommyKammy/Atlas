import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { ApiError } from "@/lib/api/errors";
import { POLICIES } from "@/lib/auth-rate-limit";
import type { Queryable } from "@/lib/db";
import { MCP_WRITE_POLICY, enforceMcpWriteLimit } from "./rate-limit";

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

/** In-memory admission store with the same failure shape as reserveAuthAttempt. */
function rateLimitStore(limit: number) {
  let attempts = 0;
  const store: Queryable = {
    query: async (sql, params) => {
      if (sql.startsWith("DELETE FROM auth_rate_limits")) return result();
      if (sql.startsWith("INSERT INTO auth_rate_limits")) {
        if (attempts >= Number(params?.[3] ?? limit)) return result();
        attempts += 1;
        return result([{ window_id: "5d1c1f84-1dc4-48d8-a5f3-2840cf81bad7" }]);
      }
      if (sql.startsWith("SELECT greatest")) return result([{ retry_after: 37 }]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { store, attempts: () => attempts };
}

test("the write policy allows 20 calls per minute", () => {
  assert.deepEqual(POLICIES["mcp-write"], { limit: 20, windowSeconds: 60 });
  assert.deepEqual(MCP_WRITE_POLICY, POLICIES["mcp-write"]);
});

test("writes pass within the per-token limit and the next call is a 429", async () => {
  const { store, attempts } = rateLimitStore(MCP_WRITE_POLICY.limit);
  for (let call = 0; call < MCP_WRITE_POLICY.limit; call++) {
    await enforceMcpWriteLimit(7, store);
  }
  assert.equal(attempts(), 20);

  await assert.rejects(
    enforceMcpWriteLimit(7, store),
    (error: unknown) =>
      error instanceof ApiError
      && error.status === 429
      && error.code === "rate_limited"
      && (error.details as { retry_after_seconds?: number }).retry_after_seconds === 37,
  );
  assert.equal(attempts(), 20);
});

test("invalid token identities fail closed without touching the limiter", async () => {
  const { store, attempts } = rateLimitStore(MCP_WRITE_POLICY.limit);
  for (const tokenId of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      enforceMcpWriteLimit(tokenId, store),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  }
  assert.equal(attempts(), 0);
});
