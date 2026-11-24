import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { db } from "../db";
import { updateTask } from "./task-update";

type Call = { sql: string; params?: unknown[] };

function result(rows: QueryResultRow[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

const PRE_UPDATE_STAMP = "2026-04-04T00:00:00.000Z";
const POST_AUTOMATION_STAMP = "2026-05-05T00:00:00.000Z";

/** Transaction client for the status update and its domain event. */
function transactionClient(calls: Call[]): PoolClient {
  return {
    query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return result([{
          id: 42,
          name: "Task",
          completed: false,
          assignee_id: null,
          status: "Todo",
          section_id: null,
          start_on: null,
          due_on: null,
          is_milestone: false,
          parent_task_id: null,
          deleted_at: null,
        }]);
      }
      if (sql.startsWith("UPDATE tasks SET status = $1, updated_at = now()")) {
        return result([{
          id: 42,
          project_id: 7,
          section_id: null,
          parent_task_id: null,
          name: "Task",
          description: "",
          assignee_id: null,
          start_on: null,
          due_on: null,
          status: "Done",
          recurrence: "none",
          is_milestone: false,
          completed: false,
          updated_at: PRE_UPDATE_STAMP,
        }]);
      }
      if (sql.includes("SELECT workspace_id FROM projects")) return result([{ workspace_id: 1 }]);
      if (sql.includes("INSERT INTO domain_events")) return result([{ id: 1 }]);
      throw new Error(`unexpected transaction query: ${sql}`);
    },
    release: () => undefined,
  } as unknown as PoolClient;
}

/** Request-scoped reads plus the automation and final stamp queries. */
function outerQueries(calls: Call[]) {
  return async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (sql.includes("SELECT project_id, start_on::text AS start_on, due_on::text AS due_on")) {
      return result([{ project_id: 7, start_on: null, due_on: null }]);
    }
    if (sql.includes("FROM project_automations")) {
      return result([{
        id: 9,
        project_id: 7,
        name: "Finish",
        trigger: "status_changed",
        action_type: "set_status",
        action_value: "Automated",
        enabled: true,
      }]);
    }
    if (sql.startsWith("UPDATE tasks SET status = $1, updated_at = now()")) {
      return result([{ id: 42 }]);
    }
    if (sql.includes("INSERT INTO automation_runs")) return result();
    if (sql.includes("SELECT updated_at::text AS updated_at FROM tasks WHERE id = $1::bigint")) {
      return result([{ updated_at: POST_AUTOMATION_STAMP }]);
    }
    if (sql.includes("SELECT project_id FROM tasks WHERE id = $1::bigint")) return result();
    if (sql.includes("INSERT INTO audit_log")) return result();
    throw new Error(`unexpected query: ${sql}`);
  };
}

test("updateTask returns the stamp re-read after synchronous automations", async (t) => {
  const outerCalls: Call[] = [];
  const clientCalls: Call[] = [];
  t.mock.method(db, "query", outerQueries(outerCalls));
  t.mock.method(Pool.prototype, "connect", async () => transactionClient(clientCalls));

  // lib/db awaits next/server connection() before opening the pool client.
  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);

  const updated = await updateTask(
    { status: "Done" },
    { taskId: 42, uid: 13, projectId: 7, authorizeProject: async () => undefined },
  );

  const automationUpdate = outerCalls.findIndex((call) =>
    call.sql.startsWith("UPDATE tasks SET status = $1, updated_at = now()"));
  const finalRead = outerCalls.findIndex((call) =>
    call.sql.includes("SELECT updated_at::text AS updated_at FROM tasks WHERE id = $1::bigint"));
  assert.ok(automationUpdate >= 0, "automation updated the task");
  assert.ok(finalRead > automationUpdate, "the stamp is read after the automation");
  assert.equal(outerCalls[finalRead].params?.[0], 42);
  assert.deepEqual(updated, { id: 42, updated_at: POST_AUTOMATION_STAMP });
  assert.notEqual(updated.updated_at, PRE_UPDATE_STAMP);
});
