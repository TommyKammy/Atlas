import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { audit } from "./audit";
import { db } from "./db";
import { getRequestContext, runWithRequestContext } from "./request-context";
import { getTaskEvents, logEvent } from "./repositories/tasks";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function queryRecorder(calls: Call[]) {
  return async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return result();
  };
}

test("audit attributes rows to the ambient MCP context without changing callers", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", queryRecorder(calls));

  await audit(42, "task.create", {
    entity: "workspace",
    workspaceId: 1,
    summary: "no context",
  });
  await runWithRequestContext(
    { via: "mcp", tokenId: 7, clientName: "Claude Code" },
    () => audit(42, "task.create", {
      entity: "workspace",
      workspaceId: 1,
      summary: "mcp context",
    }),
  );

  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, [
    1, 42, "task.create", "workspace", null, null, "no context", "web", null, null,
  ]);
  assert.deepEqual(inserts[1].params, [
    1, 42, "task.create", "workspace", null, null, "mcp context", "mcp", 7, "Claude Code",
  ]);
  assert.equal(getRequestContext(), undefined);
});

test("logEvent stores the ambient via and client_name", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", queryRecorder(calls));

  await logEvent(5, 42, "created", "タスクを作成しました");
  await runWithRequestContext(
    { via: "mcp", tokenId: 7, clientName: "Codex" },
    () => logEvent(5, 42, "created", "MCPで作成しました"),
  );

  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO task_events"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, [
    5, 42, "created", "タスクを作成しました", "web", null,
  ]);
  assert.deepEqual(inserts[1].params, [
    5, 42, "created", "MCPで作成しました", "mcp", "Codex",
  ]);
});

test("concurrent request contexts never mix", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", queryRecorder(calls));

  await Promise.all([
    runWithRequestContext(
      { via: "mcp", tokenId: 11, clientName: "client-a" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await audit(1, "task.create", {
          entity: "workspace", workspaceId: 1, summary: "context-a",
        });
      },
    ),
    runWithRequestContext(
      { via: "mcp", tokenId: 12, clientName: "client-b" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await logEvent(2, 1, "created", "context-b");
      },
    ),
  ]);

  const auditInsert = calls.find((call) => call.params?.[6] === "context-a");
  assert.ok(auditInsert);
  assert.deepEqual(auditInsert.params?.slice(7), ["mcp", 11, "client-a"]);

  const eventInsert = calls.find((call) => call.params?.[3] === "context-b");
  assert.ok(eventInsert);
  assert.deepEqual(eventInsert.params?.slice(4), ["mcp", "client-b"]);

  assert.equal(getRequestContext(), undefined);
});

test("task history reads the source and client name for display", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", queryRecorder(calls));
  await getTaskEvents(5);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /e\.via/);
  assert.match(calls[0].sql, /e\.client_name/);
});
