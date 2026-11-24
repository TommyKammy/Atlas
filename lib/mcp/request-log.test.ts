import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "@/lib/db";
import { recordMcpRequest } from "./request-log";

function result(): QueryResult {
  return { rows: [], rowCount: 1, command: "INSERT", fields: [], oid: 0 };
}

test("one MCP request writes exactly one metadata-only log row", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const store: Queryable = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return result();
    },
  };

  await recordMcpRequest({
    workspaceId: 1,
    tokenId: 7,
    userId: 42,
    endpoint: "default",
    rpcMethod: "tools/call",
    toolName: "whoami",
    outcome: "ok",
    errorCode: null,
    durationMs: 12.9,
    clientName: "Claude Code",
    clientIp: "203.0.113.10",
  }, store);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO mcp_request_log/);
  assert.deepEqual(calls[0].params, [
    1,
    7,
    42,
    "default",
    "tools/call",
    "whoami",
    "ok",
    null,
    12,
    "Claude Code",
    "203.0.113.10",
  ]);
  // Arguments and bodies are not part of the record shape at all.
  assert.ok(!calls[0].sql.includes("arguments"));
  assert.ok(!calls[0].sql.includes("body"));
});

test("a failed log write never escapes to the request", async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  const store: Queryable = {
    query: async () => {
      throw new Error("log store unavailable");
    },
  };
  try {
    await assert.doesNotReject(recordMcpRequest({
      workspaceId: null,
      tokenId: null,
      userId: null,
      endpoint: "readonly",
      rpcMethod: "tools/list",
      toolName: null,
      outcome: "unauthenticated",
      errorCode: "invalid",
      durationMs: 1,
      clientName: null,
      clientIp: null,
    }, store));
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.some((args) => String(args[0]).includes("log write failed")));
});
