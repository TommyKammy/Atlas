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
