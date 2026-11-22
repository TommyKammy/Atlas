import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import type { Actor } from "./actor";
import { trashTaskForActor, updateTaskForActor } from "./task-actions";
import { TaskMutationFailure } from "./task-mutation-failure";

type UserFlags = {
  /** Role used for every project unless `roles` overrides it. */
  role?: string | null;
  /** Per-project role overrides; null means "not a member". */
  roles?: Record<number, string | null>;
};

type TaskContext = { default_project_id: number | null; project_ids: Array<number | string> };

/**
 * Minimal Queryable for loadAuthActor, getTaskProjectContext, getProjectAccess
 * and the task lookup performed by updateTask.
 */
function mockQueries(
  options: {
    users?: Record<number, UserFlags>;
    context?: TaskContext | null;
    task?: { project_id: number | null; start_on: string | null; due_on: string | null } | null;
  },
  calls: string[],
) {
  return async (sql: string, params?: unknown[]) => {
    calls.push(sql);
    const uid = Number(params?.[0]);
    const user = options.users?.[uid];
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("AS default_project_id")) {
      rows = options.context ? [{ ...options.context }] : [];
    } else if (sql.includes("LEFT JOIN project_members")) {
      if (user) {
        const projectId = Number(params?.[1]);
        const role = user.roles && projectId in user.roles
          ? user.roles[projectId]
          : (user.role ?? null);
        rows = [{
          is_admin: false,
          deactivated_at: null,
          role,
        }];
      }
    } else if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      rows = user
        ? [{ is_admin: false, is_guest: false, deactivated_at: null }]
        : [];
    } else if (sql.includes("SELECT project_id, start_on::text AS start_on")) {
      rows = options.task ? [{ ...options.task }] : [];
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  };
}

const actor: Actor = { uid: 13, source: "web" };

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

test("updateTaskForActor surfaces a task authorization failure as ApiError", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    users: { 13: { role: "viewer" } },
    context: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assertApiError(
    updateTaskForActor(actor, 42, { name: "changed" }),
    403,
    "insufficient project role",
    "forbidden",
  );
  assert.equal(calls.length, 3);
});

test("updateTaskForActor maps a denied destination project to TaskMutationFailure", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    users: { 13: { role: "editor", roles: { 7: "editor", 9: null } } },
    context: { default_project_id: 7, project_ids: [7] },
    task: { project_id: 7, start_on: null, due_on: null },
  }, calls));
  await assert.rejects(
    updateTaskForActor(actor, 42, { project_id: 9 }),
    (error: unknown) => {
      assert.ok(error instanceof TaskMutationFailure, `expected TaskMutationFailure, got ${String(error)}`);
      assert.equal(error.reason, "denied");
      assert.equal(error.message, "project access denied");
      return true;
    },
  );
  assert.equal(calls.length, 6);
});

test("trashTaskForActor authorizes the primary project, not a secondary home", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockQueries({
    users: { 13: { roles: { 7: null, 9: "editor" } } },
    context: { default_project_id: 7, project_ids: [7, 9] },
  }, calls));
  await assertApiError(
    trashTaskForActor(actor, 42),
    403,
    "project access denied",
    "forbidden",
  );
  assert.equal(calls.length, 3);
});

test("trashTaskForActor only requests a logical delete", () => {
  const source = readFileSync(new URL("./task-actions.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /export async function trashTaskForActor\(actor: Actor, taskId: number\): Promise<\{ deleted: number \}>/,
  );
  const body = source.match(/export async function trashTaskForActor[\s\S]*?\n}\n/)?.[0];
  assert.ok(body, "trashTaskForActor body not found");
  assert.match(body, /\{ scope: "primary" \}/);
  assert.match(body, /deleteTask\(\{ force: false \}, \{ taskId, uid: actor\.uid, projectId: auth\.projectId \}\)/);
});
