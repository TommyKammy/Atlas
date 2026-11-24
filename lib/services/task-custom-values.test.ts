import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db, type Queryable } from "../db";
import { runWithRequestContext } from "../request-context";
import type { Actor } from "./actor";
import { setTaskCustomValue, writeTaskCustomValue } from "./task-custom-values";
import { TaskMutationFailure } from "./task-mutation-failure";

type Call = { sql: string; params?: unknown[] };

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
  taskUpdatedAt?: string;
  nextUpdatedAt?: string;
  writes?: string[];
  calls?: Call[];
}): Queryable {
  return {
    query: async (sql: string, params?: unknown[]) => {
      options.writes?.push(sql);
      options.calls?.push({ sql, params });
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE")) {
        rows = [{
          id: Number(params?.[0]),
          updated_at: options.taskUpdatedAt ?? "2026-01-01T00:00:00.000Z",
        }];
      } else if (sql.includes("FROM custom_fields")) {
        rows = options.field ? [{ ...options.field }] : [];
      } else if (sql.includes("LEFT JOIN project_members")) {
        rows = options.member ? [{ ...options.member }] : [];
      } else if (sql.includes("UPDATE tasks SET updated_at = now()")) {
        const updated_at = options.nextUpdatedAt ?? "2026-01-02T00:00:00.000Z";
        options.taskUpdatedAt = updated_at;
        rows = [{ updated_at }];
      } else if (sql.includes("INSERT INTO task_custom_values")
          || sql.includes("DELETE FROM task_custom_values")) {
        rows = [];
      } else if (sql.includes("SELECT workspace_id FROM projects")) {
        rows = [{ workspace_id: 1 }];
      } else if (sql.includes("INSERT INTO task_events")) {
        rows = [{ id: 1 }];
      } else if (sql.includes("INSERT INTO audit_log")) {
        rows = [];
      } else if (sql.includes("INSERT INTO domain_events")) {
        rows = [{ id: 1 }];
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

test("writeTaskCustomValue rejects a stale expected stamp inside the lock", async () => {
  const writes: string[] = [];
  await assert.rejects(
    writeTaskCustomValue(fakeTransactionQueries({
      field: field(),
      taskUpdatedAt: "2026-02-02T00:00:00.000Z",
      writes,
    }), {
      actor,
      taskId: 42,
      projectId: 7,
      fieldId: 5,
      value: "x",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    }),
    (error: unknown) => {
      assert.ok(error instanceof TaskMutationFailure, `expected TaskMutationFailure, got ${String(error)}`);
      assert.equal(error.reason, "conflict");
      assert.equal(error.message, "conflict");
      assert.deepEqual(error.metadata, { current_updated_at: "2026-02-02T00:00:00.000Z" });
      return true;
    },
  );
  assert.equal(writes.length, 1);
  assert.match(writes[0], /FOR UPDATE/);
});

test("writeTaskCustomValue advances tasks.updated_at and returns it", async () => {
  const writes: string[] = [];
  const result = await writeTaskCustomValue(fakeTransactionQueries({
    field: field(),
    taskUpdatedAt: "2026-01-01T00:00:00.000Z",
    nextUpdatedAt: "2026-01-02T00:00:00.000Z",
    writes,
  }), {
    actor,
    taskId: 42,
    projectId: 7,
    fieldId: 5,
    value: "changed",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(result, { cleared: false, updated_at: "2026-01-02T00:00:00.000Z" });
  const valueWrite = writes.findIndex((sql) => sql.includes("INSERT INTO task_custom_values"));
  const stampWrite = writes.findIndex((sql) => sql.includes("UPDATE tasks SET updated_at = now()"));
  assert.ok(valueWrite >= 0, "value write");
  assert.ok(stampWrite > valueWrite, "updated_at bump follows the value write");
});

test("writeTaskCustomValue records the change in task history and audit on the transaction Queryable", async () => {
  const calls: Call[] = [];
  await writeTaskCustomValue(fakeTransactionQueries({
    field: field(),
    calls,
  }), {
    actor,
    taskId: 42,
    projectId: 7,
    fieldId: 5,
    value: "changed",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });

  const valueWrite = calls.findIndex((call) => call.sql.includes("INSERT INTO task_custom_values"));
  const history = calls.find((call) => call.sql.includes("INSERT INTO task_events"));
  const auditRow = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(valueWrite >= 0, "value write");
  assert.ok(history, "task history insert");
  assert.ok(auditRow, "audit insert");
  assert.ok(calls.indexOf(history) > valueWrite, "history follows the value write");
  assert.ok(calls.indexOf(auditRow) > valueWrite, "audit follows the value write");
  assert.deepEqual(history.params, [
    42, 13, "custom_field_changed", "カスタムフィールド「Estimate」を変更しました", "web", null,
  ]);
  assert.deepEqual(auditRow.params, [
    1, 13, "task.custom_field_update", "task", 42, 7, "Estimate", "web", null, null,
  ]);
});

test("writeTaskCustomValue carries the MCP attribution into history and audit", async () => {
  const calls: Call[] = [];
  await runWithRequestContext(
    { via: "mcp", tokenId: 9, clientName: "Codex" },
    () => writeTaskCustomValue(fakeTransactionQueries({
      field: field(),
      calls,
    }), {
      actor,
      taskId: 42,
      projectId: 7,
      fieldId: 5,
      value: "changed",
    }),
  );

  const history = calls.find((call) => call.sql.includes("INSERT INTO task_events"));
  const auditRow = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(history, "task history insert");
  assert.ok(auditRow, "audit insert");
  assert.deepEqual(history.params, [
    42, 13, "custom_field_changed", "カスタムフィールド「Estimate」を変更しました", "mcp", "Codex",
  ]);
  assert.deepEqual(auditRow.params, [
    1, 13, "task.custom_field_update", "task", 42, 7, "Estimate", "mcp", 9, "Codex",
  ]);
});

test("writeTaskCustomValue records a clear with the clear wording", async () => {
  const calls: Call[] = [];
  const result = await writeTaskCustomValue(fakeTransactionQueries({
    field: field(),
    calls,
  }), {
    actor,
    taskId: 42,
    projectId: 7,
    fieldId: 5,
    value: null,
  });

  assert.equal(result.cleared, true);
  const history = calls.find((call) => call.sql.includes("INSERT INTO task_events"));
  assert.ok(history, "task history insert");
  assert.deepEqual(history.params, [
    42, 13, "custom_field_changed", "カスタムフィールド「Estimate」をクリアしました", "web", null,
  ]);
});

test("writeTaskCustomValue bumps the stamp when it clears a value", async () => {
  const writes: string[] = [];
  const result = await writeTaskCustomValue(fakeTransactionQueries({
    field: field(),
    nextUpdatedAt: "2026-01-03T00:00:00.000Z",
    writes,
  }), {
    actor,
    taskId: 42,
    projectId: 7,
    fieldId: 5,
    value: null,
  });

  assert.deepEqual(result, { cleared: true, updated_at: "2026-01-03T00:00:00.000Z" });
  assert.ok(writes.some((sql) => sql.includes("DELETE FROM task_custom_values")));
  assert.ok(writes.some((sql) => sql.includes("UPDATE tasks SET updated_at = now()")));
});

test("a repeated expected stamp conflicts after the first write advances updated_at", async () => {
  const q = fakeTransactionQueries({ field: field() });
  const write = () => writeTaskCustomValue(q, {
    actor,
    taskId: 42,
    projectId: 7,
    fieldId: 5,
    value: "x",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });

  const first = await write();
  assert.equal(first.updated_at, "2026-01-02T00:00:00.000Z");

  await assert.rejects(
    write(),
    (error: unknown) => {
      assert.ok(error instanceof TaskMutationFailure, `expected TaskMutationFailure, got ${String(error)}`);
      assert.equal(error.reason, "conflict");
      assert.deepEqual(error.metadata, { current_updated_at: "2026-01-02T00:00:00.000Z" });
      return true;
    },
  );
});

test("POST /api/task-values adds updated_at while keeping the existing body and status", () => {
  const source = readFileSync(
    new URL("../../app/api/task-values/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /cleared: true, updated_at: result\.updated_at/);
  assert.match(source, /ok: true, updated_at: result\.updated_at/);
  assert.match(source, /status: result\.cleared \? 200 : 201/);
});
