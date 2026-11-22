import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db, type Queryable } from "../db";
import type { Actor } from "./actor";
import { setTaskCustomValue, writeTaskCustomValue } from "./task-custom-values";

type TaskContext = { default_project_id: number | null; project_ids: number[] };

/** Minimal Queryable for loadAuthActor, getTaskProjectContext and getProjectAccess. */
function mockAuthQueries(options: { role: string | null; context: TaskContext }, calls: string[]) {
  return async (sql: string) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("AS default_project_id")) {
      rows = [{ ...options.context }];
    } else if (sql.includes("LEFT JOIN project_members")) {
      rows = [{ is_admin: false, deactivated_at: null, role: options.role }];
    } else if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      rows = [{ is_admin: false, is_guest: false, deactivated_at: null }];
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  };
}

type FieldRow = {
  name: string;
  field_type: string;
  project_id: number;
  config: null;
  access_level: string;
  editor_ids: number[];
};

/** Queryable for the transaction body, including the field-access lookup. */
function fakeTransactionQueries(options: {
  field?: FieldRow | null;
  member?: { is_admin: boolean; role: string | null };
}): Queryable {
  return {
    query: async (sql: string, params?: unknown[]) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE")) {
        rows = [{ id: Number(params?.[0]) }];
      } else if (sql.includes("FROM custom_fields")) {
        rows = options.field ? [{ ...options.field }] : [];
      } else if (sql.includes("LEFT JOIN project_members")) {
        rows = options.member ? [{ ...options.member }] : [];
      } else {
        throw new Error(`unexpected query: ${sql}`);
      }
      return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
    },
  };
}

const actor: Actor = { uid: 13, source: "web" };

const field = (overrides: Partial<FieldRow> = {}): FieldRow => ({
  name: "Estimate",
  field_type: "text",
  project_id: 7,
  config: null,
  access_level: "everyone",
  editor_ids: [],
  ...overrides,
});

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

test("setTaskCustomValue rejects an invalid task_id before authorization", async (t) => {
  const query = t.mock.method(db, "query", async () => {
    throw new Error("database must not be reached");
  });
  for (const task_id of [undefined, null, "", 0, -1, "abc", 1.5]) {
    await assertApiError(
      setTaskCustomValue(actor, { task_id, field_id: 5, value: "x" }),
      400,
      "invalid task_id",
      "bad_request",
    );
  }
  assert.equal(query.mock.callCount(), 0);
});

test("setTaskCustomValue requires field_id after authorizing the task", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({
    role: "editor",
    context: { default_project_id: 7, project_ids: [7] },
  }, calls));
  await assertApiError(
    setTaskCustomValue(actor, { task_id: 42 }),
    400,
    "task_id and field_id are required",
    "bad_request",
  );
  assert.equal(calls.length, 3);
});

test("setTaskCustomValue reports a field from another project as not found", async () => {
  await assertApiError(
    writeTaskCustomValue(fakeTransactionQueries({ field: field({ project_id: 9 }) }), {
      actor,
      taskId: 42,
      projectId: 7,
      fieldId: 5,
      value: "x",
    }),
    404,
    "field not found",
    "not_found",
  );
});

test("setTaskCustomValue rejects a field the actor cannot edit", async () => {
  await assertApiError(
    writeTaskCustomValue(fakeTransactionQueries({
      field: field({ access_level: "admins" }),
      member: { is_admin: false, role: "editor" },
    }), {
      actor,
      taskId: 42,
      projectId: 7,
      fieldId: 5,
      value: "x",
    }),
    403,
    "field access denied",
    "forbidden",
  );
});
