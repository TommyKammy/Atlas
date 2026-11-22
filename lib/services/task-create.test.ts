import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import type { Actor } from "./actor";
import { createTask } from "./task-create";

type AuthOptions = {
  role?: string | null;
  isAdmin?: boolean;
  sectionProjectId?: number | null;
  parentProjectId?: number | null;
  assigneeFound?: boolean;
};

const actor: Actor = { uid: 13, source: "web" };

/** Minimal Queryable for the authorization and lookup SQL used by createTask. */
function mockQueries(options: AuthOptions, calls: string[]) {
  return async (sql: string, params?: unknown[]) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("LEFT JOIN project_members")) {
      rows = [{
        is_admin: options.isAdmin ?? false,
        deactivated_at: null,
        role: options.role ?? null,
      }];
    } else if (sql.includes("SELECT project_id FROM sections")) {
      rows = options.sectionProjectId == null ? [] : [{ project_id: options.sectionProjectId }];
    } else if (sql.includes("FROM tasks t WHERE t.id")) {
      rows = [{ project_id: options.parentProjectId ?? null }];
    } else if (sql.includes("SELECT id FROM users WHERE id")) {
      rows = options.assigneeFound ? [{ id: Number(params?.[0]) }] : [];
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

test("createTask validates is_milestone before the name, as the route did", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({}, calls));
  await assertApiError(
    createTask(actor, { is_milestone: "yes" }),
    400,
    "is_milestone must be a boolean",
    "bad_request",
  );
  assert.equal(calls.length, 0);
});

test("createTask rejects a missing name before touching the database", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({}, calls));
  await assertApiError(createTask(actor, { project_id: 7 }), 400, "name is required", "bad_request");
  await assertApiError(createTask(actor, { project_id: 7, name: "   " }), 400, "name is required", "bad_request");
  assert.equal(calls.length, 0);
});

test("createTask validates project_id before authorization", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({}, calls));
  await assertApiError(createTask(actor, { name: "Task" }), 400, "project_id is required", "bad_request");
  await assertApiError(createTask(actor, { name: "Task", project_id: "" }), 400, "project_id is required", "bad_request");
  await assertApiError(createTask(actor, { name: "Task", project_id: "abc" }), 400, "invalid project_id", "bad_request");
  await assertApiError(createTask(actor, { name: "Task", project_id: 0 }), 400, "invalid project_id", "bad_request");
  assert.equal(calls.length, 0);
});

test("createTask checks edit permission before section, parent and assignee lookups", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ role: "viewer", sectionProjectId: 9 }, calls));
  await assertApiError(
    createTask(actor, { name: "Task", project_id: 7, section_id: 9 }),
    403,
    "insufficient project role",
    "forbidden",
  );
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((sql) => sql.includes("FROM sections")));
});

test("createTask rejects a section from another project", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ role: "editor", sectionProjectId: 9 }, calls));
  await assertApiError(
    createTask(actor, { name: "Task", project_id: 7, section_id: 9 }),
    400,
    "section does not belong to project",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("createTask rejects a parent task from another project", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ role: "editor", parentProjectId: 9 }, calls));
  await assertApiError(
    createTask(actor, { name: "Task", project_id: 7, parent_task_id: 42 }),
    400,
    "parent task is in another project",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("createTask rejects an unknown or inactive assignee", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ role: "editor", assigneeFound: false }, calls));
  await assertApiError(
    createTask(actor, { name: "Task", project_id: 7, assignee_id: 5 }),
    400,
    "assignee not found",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("createTask rejects a milestone with a parent after the parent check", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({ role: "editor", parentProjectId: 7 }, calls));
  await assertApiError(
    createTask(actor, { name: "Task", project_id: 7, parent_task_id: 42, is_milestone: true }),
    400,
    "milestone cannot be a subtask",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});
