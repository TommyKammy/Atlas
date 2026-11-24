import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import { addComment } from "./comments";
import type { Actor } from "./actor";

type TaskContext = { default_project_id: number | null; project_ids: number[] };

type AuthOptions = {
  role?: string | null;
  isAdmin?: boolean;
  task?: TaskContext | null;
};

const actor: Actor = { uid: 12, source: "web" };

/** Minimal Queryable for the authorization SQL used by addComment. */
function mockQueries(options: AuthOptions, calls: string[]) {
  return async (sql: string) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("LEFT JOIN project_members")) {
      rows = [{
        is_admin: options.isAdmin ?? false,
        deactivated_at: null,
        role: options.role ?? null,
      }];
    } else if (sql.includes("AS default_project_id")) {
      rows = options.task ? [{ ...options.task }] : [];
    } else if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      rows = [{
        is_admin: options.isAdmin ?? false,
        is_guest: false,
        deactivated_at: null,
      }];
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  };
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  message: string,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.equal(error.code, code);
    return true;
  });
}

test("addComment rejects an invalid task_id before authorization", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({}, calls));
  for (const task_id of [undefined, null, "", 0, -1, "abc", 1.5]) {
    await assertApiError(
      addComment(actor, { task_id, body: "hello" }),
      400,
      "invalid task_id",
      "bad_request",
    );
  }
  assert.equal(calls.length, 0);
});

test("addComment reports a missing task before parsing the payload", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ task: null }, calls));
  await assertApiError(
    addComment(actor, { task_id: 42, body: "" }),
    404,
    "task not found",
    "not_found",
  );
  assert.equal(calls.length, 2);
});

test("addComment requires the comment permission before parsing the payload", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "viewer",
    task: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assertApiError(
    addComment(actor, { task_id: 42, body: "" }),
    403,
    "insufficient project role",
    "forbidden",
  );
  assert.equal(calls.length, 3);
});

test("addComment lets commenters reach payload validation", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "commenter",
    task: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assertApiError(
    addComment(actor, { task_id: 42, body: "   " }),
    400,
    "body is required",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("addComment rejects an over-long comment body", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "commenter",
    task: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assertApiError(
    addComment(actor, { task_id: 42, body: "x".repeat(10_001) }),
    400,
    "body is too long",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("addComment rejects an invalid rich-text document", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "commenter",
    task: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assert.rejects(
    addComment(actor, { task_id: 42, body_doc: { type: "doc", content: "nope" } }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.ok(error.message.startsWith("invalid body_doc: "), error.message);
      return true;
    },
  );
  assert.equal(calls.length, 3);
});

type Call = { sql: string; params?: unknown[] };

const WORKSPACE_ID = 3;

function queryResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

/** Mocks the transaction client and lib/db's next/server connection() for a successful addComment. */
async function mockCommentWrite(t: import("node:test").TestContext) {
  const { Pool } = await import("pg");
  const { createRequire } = await import("node:module");
  t.mock.method(Pool.prototype, "connect", async () => ({
    query: async (sql: string) => {
      if (sql.includes("INSERT INTO comments")) return queryResult([{ id: 501 }]);
      // Mention writes and emitTaskEvent's lookups; no workspace skips the domain event.
      return queryResult([]);
    },
    release: () => undefined,
  }));
  const nextServer = createRequire(import.meta.url)("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);
}

/** Auth queries plus notifyTask and the audit write, recorded in `calls`. */
function mockCommentDb(options: AuthOptions, calls: Call[]) {
  const auth = mockQueries(options, []);
  return async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    // notifyTask: no project, so no Redis publish is attempted.
    if (sql.includes("SELECT project_id FROM tasks")) return queryResult([{ project_id: null }]);
    if (sql.includes("SELECT workspace_id FROM projects")) return queryResult([{ workspace_id: WORKSPACE_ID }]);
    if (sql.includes("SELECT id FROM workspaces")) return queryResult([{ id: WORKSPACE_ID }]);
    if (sql.includes("INSERT INTO audit_log")) return queryResult([]);
    // Mention candidates: the plain-text body mentions nobody.
    if (sql.includes("SELECT u.id, u.name FROM users u")) return queryResult([]);
    return auth(sql);
  };
}

function auditInsert(calls: Call[]): unknown[] {
  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.equal(inserts.length, 1);
  return inserts[0].params ?? [];
}

test("addComment records the task's project and workspace on the audit row", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockCommentDb({
    role: "commenter",
    task: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await mockCommentWrite(t);

  assert.deepEqual(await addComment(actor, { task_id: 42, body: "hello" }), { id: 501 });

  // getAuditLog filters by audit_log.workspace_id, so the row must carry it.
  const [workspaceId, actorId, action, entity, entityId, projectId] = auditInsert(calls);
  assert.equal(workspaceId, WORKSPACE_ID);
  assert.equal(actorId, actor.uid);
  assert.equal(action, "comment.create");
  assert.equal(entity, "comment");
  assert.equal(entityId, 501);
  assert.equal(projectId, 7);
});

test("addComment on a task without any project still records the workspace", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockCommentDb({
    isAdmin: true,
    task: { default_project_id: null, project_ids: [] },
  }, calls));
  await mockCommentWrite(t);

  assert.deepEqual(await addComment(actor, { task_id: 42, body: "hello" }), { id: 501 });

  const [workspaceId, , action, , , projectId] = auditInsert(calls);
  assert.equal(action, "comment.create");
  assert.equal(workspaceId, WORKSPACE_ID);
  assert.equal(projectId, null);
});
