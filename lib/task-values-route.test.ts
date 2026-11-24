import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { db } from "./db";
import { generateSessionToken } from "./session-token";

type Call = { sql: string; params?: unknown[] };

const TASK_ID = 42;
const PROJECT_ID = 7;
const UID = 13;
const CURRENT_STAMP = "2026-02-02T00:00:00.000Z";
const NEXT_STAMP = "2026-03-03T00:00:00.000Z";

function result(rows: QueryResultRow[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

function currentTask() {
  return {
    name: "Task",
    completed: false,
    assignee_id: null,
    assignee_name: null,
    start_on: null,
    due_on: null,
    progress: 0,
    status: "Todo",
    description: "",
    section_id: null,
    is_milestone: false,
    updated_at: CURRENT_STAMP,
  };
}

/** Session, task authorization, and the snapshot used by a 409 response. */
function outerQueries(calls: Call[]) {
  return async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (sql.includes("FROM user_sessions")) {
      return result([{
        id: UID,
        name: "Editor",
        email: "editor@example.com",
        is_admin: false,
        is_guest: false,
        totp_enabled: false,
        mfa_pending: false,
      }]);
    }
    if (sql.includes("AS default_project_id")) {
      return result([{ id: TASK_ID, default_project_id: PROJECT_ID, project_ids: [PROJECT_ID] }]);
    }
    if (sql.includes("LEFT JOIN project_members")) {
      return result([{ is_admin: false, deactivated_at: null, role: "editor" }]);
    }
    if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      return result([{ is_admin: false, is_guest: false, deactivated_at: null }]);
    }
    if (sql.includes("FROM tasks t LEFT JOIN users u")) {
      return result([currentTask()]);
    }
    if (sql.includes("SELECT project_id FROM tasks")) return result();
    if (sql.includes("SELECT project_id FROM custom_fields")) return result();
    throw new Error(`unexpected query: ${sql}`);
  };
}

/** Transaction client for writeTaskCustomValue. */
function transactionClient(options: { taskUpdatedAt: string; calls: Call[] }): PoolClient {
  return {
    query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
      options.calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE")) {
        return result([{ id: TASK_ID, updated_at: options.taskUpdatedAt }]);
      }
      if (sql.includes("FROM custom_fields")) {
        return result([{
          name: "Estimate",
          field_type: "text",
          project_id: PROJECT_ID,
          config: null,
          access_level: "everyone",
          editor_ids: [],
        }]);
      }
      if (sql.includes("INSERT INTO task_custom_values") || sql.includes("DELETE FROM task_custom_values")) {
        return result();
      }
      if (sql.includes("UPDATE tasks SET updated_at = now()")) {
        options.taskUpdatedAt = NEXT_STAMP;
        return result([{ updated_at: NEXT_STAMP }]);
      }
      if (sql.includes("SELECT workspace_id FROM projects")) return result([{ workspace_id: 1 }]);
      if (sql.includes("INSERT INTO task_events")) return result([{ id: 1 }]);
      if (sql.includes("INSERT INTO audit_log")) return result();
      if (sql.includes("INSERT INTO domain_events")) return result([{ id: 1 }]);
      throw new Error(`unexpected transaction query: ${sql}`);
    },
    release: () => undefined,
  } as unknown as PoolClient;
}

async function postTaskValue(
  t: TestContext,
  body: Record<string, unknown>,
  options: { taskUpdatedAt: string },
) {
  const outerCalls: Call[] = [];
  const clientCalls: Call[] = [];
  t.mock.method(db, "query", outerQueries(outerCalls));
  t.mock.method(Pool.prototype, "connect", async () => transactionClient({
    taskUpdatedAt: options.taskUpdatedAt,
    calls: clientCalls,
  }));

  // lib/db awaits next/server connection() before opening the pool client.
  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);

  const request = new NextRequest("http://localhost/api/task-values", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `atlas_session=${generateSessionToken()}`,
    },
    body: JSON.stringify({ task_id: TASK_ID, field_id: 5, value: "changed", ...body }),
  });
  const { POST } = await import("../app/api/task-values/route");
  const response = await POST(request);
  return { response, body: await response.json() as Record<string, unknown> };
}

test("POST /api/task-values still succeeds without expected_updated_at", async (t) => {
  const { response, body } = await postTaskValue(t, {}, { taskUpdatedAt: CURRENT_STAMP });
  assert.equal(response.status, 201);
  assert.deepEqual(body, { ok: true, updated_at: NEXT_STAMP });
});

test("POST /api/task-values returns the PATCH-shaped 409 for a stale stamp", async (t) => {
  const { response, body } = await postTaskValue(
    t,
    { expected_updated_at: "2026-01-01T00:00:00.000Z" },
    { taskUpdatedAt: CURRENT_STAMP },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(Object.keys(body).sort(), ["current", "error", "updated_at"]);
  assert.equal(body.error, "conflict");
  assert.equal(body.updated_at, CURRENT_STAMP);
  assert.deepEqual(body.current, currentTask());
  assert.equal((body.current as { updated_at: string }).updated_at, body.updated_at);
});
