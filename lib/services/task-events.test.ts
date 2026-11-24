import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "../db";
import { runWithRequestContext } from "../request-context";
import { insertTaskEvent, insertTaskEvents } from "../repositories/tasks";
import { recordTaskCompletion, type TaskCompletionRow } from "./task-completion";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function queryRecorder(calls: Call[]): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT workspace_id")) return result([{ workspace_id: 1 }]);
      if (sql.includes("INSERT INTO domain_events")) return result([{ id: 1 }]);
      if (sql.includes("INSERT INTO task_events")) return result([{ id: 99 }]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function completionTask(): TaskCompletionRow {
  return {
    id: 5,
    project_id: 1,
    section_id: null,
    parent_task_id: 4,
    name: "Ship it",
    description: "",
    assignee_id: null,
    start_on: null,
    due_on: null,
    status: "inbox",
    recurrence: "none",
    is_milestone: false,
    completed: true,
  };
}

test("recordTaskCompletion writes the ambient MCP via and client name", async () => {
  const calls: Call[] = [];
  const q = queryRecorder(calls);

  await runWithRequestContext(
    { via: "mcp", tokenId: 7, clientName: "Claude Code" },
    () => recordTaskCompletion(q, {
      task: completionTask(),
      projectId: 1,
      actorId: 42,
    }),
  );

  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO task_events"));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params, [
    5, 42, "completed", "タスクを完了しました", "mcp", "Claude Code",
  ]);
});

test("direct history inserts default to web when no request context exists", async () => {
  const calls: Call[] = [];
  const q = queryRecorder(calls);

  await insertTaskEvent(q, {
    taskId: 5,
    actorId: 42,
    kind: "created",
    summary: "タスクを作成しました",
  });
  await insertTaskEvents(q, {
    taskIds: [5, 6],
    actorId: 42,
    kind: "assignee_changed",
    summary: "担当者を変更しました",
  });

  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO task_events"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, [
    5, 42, "created", "タスクを作成しました", "web", null,
  ]);
  assert.deepEqual(inserts[1].params, [
    [5, 6], 42, "assignee_changed", "担当者を変更しました", "web", null,
  ]);
});

test("bulk history inserts carry the same MCP attribution", async () => {
  const calls: Call[] = [];
  const q = queryRecorder(calls);

  await runWithRequestContext(
    { via: "mcp", tokenId: 11, clientName: "Codex" },
    () => insertTaskEvents(q, {
      taskIds: [5, 6],
      actorId: 42,
      kind: "assignee_changed",
      summary: "担当者を変更しました",
    }),
  );

  const insert = calls.find((call) => call.sql.includes("INSERT INTO task_events"));
  assert.ok(insert);
  assert.deepEqual(insert.params, [
    [5, 6], 42, "assignee_changed", "担当者を変更しました", "mcp", "Codex",
  ]);
});

test("every direct task history writer goes through the attribution helper", () => {
  const files = [
    new URL("./task-completion.ts", import.meta.url),
    new URL("./task-approval.ts", import.meta.url),
    new URL("./project-import.ts", import.meta.url),
    new URL("../../app/api/tasks/bulk/route.ts", import.meta.url),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /insertTaskEvents?\(/, `${file.pathname} must use the shared helper`);
    assert.doesNotMatch(
      source,
      /INSERT INTO task_events/,
      `${file.pathname} must not write task_events directly`,
    );
  }
});
