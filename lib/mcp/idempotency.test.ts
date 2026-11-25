import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { ApiError } from "@/lib/api/errors";
import { db, type Queryable } from "@/lib/db";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  idempotencyRequestHash,
  withIdempotency,
} from "./idempotency";

type Call = { sql: string; params?: unknown[] };
type StoredRow = {
  id: number;
  tokenId: number;
  toolName: string;
  key: string;
  hash: string;
  response: unknown;
  ownerToken: string;
  createdTaskId: number | null;
  /** Stands in for created_at older than the stale window. */
  stale: boolean;
};

function result(
  rows: Record<string, unknown>[] = [],
  rowCount = rows.length,
): QueryResult {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}

/**
 * Minimal in-memory stand-in for the mcp_idempotency table. It preserves the
 * unique (token, tool, key) constraint and returns an empty INSERT result when
 * a fresh reservation already exists.
 */
function idempotencyStore(calls: Call[]) {
  const rows = new Map<string, StoredRow>();
  let nextId = 1;
  const mapKey = (tokenId: unknown, toolName: unknown, key: unknown) =>
    JSON.stringify([tokenId, toolName, key]);

  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO mcp_idempotency")) {
      const [tokenId, toolName, key, hash] = params as [number, string, string, string];
      const ownerToken = String(params[6]);
      const keyId = mapKey(tokenId, toolName, key);
      if (rows.has(keyId)) return result([]);
      const row: StoredRow = {
        id: nextId++, tokenId, toolName, key, hash, response: null, ownerToken, createdTaskId: null, stale: false,
      };
      rows.set(keyId, row);
      return result([{ id: row.id, owner_token: row.ownerToken }]);
    }
    if (sql.includes("SELECT id, request_hash, response")) {
      const [tokenId, toolName, key] = params;
      const row = rows.get(mapKey(tokenId, toolName, key));
      return result(row
        ? [{
            id: row.id,
            request_hash: row.hash,
            response: row.response,
            in_flight: row.response === null,
            created_task_id: row.createdTaskId,
            stale: row.stale,
          }]
        : []);
    }
    if (sql.includes("SET created_task_id")) {
      const [id, ownerToken, taskId] = params as [number, string, number];
      for (const row of rows.values()) {
        if (row.id === Number(id) && row.ownerToken === String(ownerToken) && row.response === null) {
          row.createdTaskId = Number(taskId);
          return result([], 1);
        }
      }
      return result([], 0);
    }
    if (sql.includes("UPDATE mcp_idempotency SET response")) {
      const [id, ownerToken, payload] = params as [number, string, string];
      for (const row of rows.values()) {
        if (row.id === Number(id) && row.ownerToken === String(ownerToken)) {
          row.response = JSON.parse(payload);
          return result([], 1);
        }
      }
      return result([], 0);
    }
    if (sql.includes("DELETE FROM mcp_idempotency")) {
      assert.match(sql, /created_task_id IS NULL/);
      const [id, ownerToken] = params;
      for (const [key, row] of rows) {
        if (row.id === Number(id) && row.ownerToken === String(ownerToken) && row.createdTaskId === null) {
          rows.delete(key);
          return result([], 1);
        }
      }
      return result([], 0);
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return { rows, query };
}

const BASE = { tokenId: 7, toolName: "save_task", key: "create-1" };

test("without a key the tool runs directly and never touches idempotency storage", async (t) => {
  t.mock.method(db, "query", async () => assert.fail("idempotency storage must not be used"));
  let runs = 0;
  const expected = { id: 1 };
  const result = await withIdempotency(
    { ...BASE, key: undefined, args: { name: "Task" } },
    async () => {
      runs++;
      return expected;
    },
  );
  assert.equal(result, expected);
  assert.equal(runs, 1);
});

test("a first call records its response and a resend returns it without rerunning", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  const input = { ...BASE, args: { name: "Task", due_on: "2026-12-01" } };

  const first = await withIdempotency(input, async () => {
    runs++;
    return { id: 41, name: "Task" };
  });
  const second = await withIdempotency(input, async () => {
    runs++;
    return { id: 42, name: "Task" };
  });

  assert.deepEqual(first, { id: 41, name: "Task" });
  assert.deepEqual(second, first);
  assert.equal(runs, 1);
  assert.equal(store.rows.size, 1);
});

test("argument key order does not defeat the request hash", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  await withIdempotency(
    { ...BASE, args: { name: "Task", due_on: "2026-12-01" } },
    async () => {
      runs++;
      return { id: 1 };
    },
  );
  const cached = await withIdempotency(
    { ...BASE, args: { due_on: "2026-12-01", name: "Task" } },
    async () => {
      runs++;
      return { id: 2 };
    },
  );
  assert.deepEqual(cached, { id: 1 });
  assert.equal(runs, 1);
  assert.equal(idempotencyRequestHash({ b: 2, a: 1 }), idempotencyRequestHash({ a: 1, b: 2 }));
});

test("reusing a key with different arguments is a 409", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  await withIdempotency(
    { ...BASE, args: { name: "First" } },
    async () => ({ id: 1 }),
  );
  await assert.rejects(
    withIdempotency(
      { ...BASE, args: { name: "Second" } },
      async () => ({ id: 2 }),
    ),
    (error: unknown) =>
      error instanceof ApiError
      && error.status === 409
      && error.message === "idempotency key reused with different arguments",
  );
});

test("a failed call leaves no record and can be retried", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  const input = { ...BASE, args: { name: "Task" } };

  await assert.rejects(
    withIdempotency(input, async () => {
      runs++;
      throw new Error("database write failed");
    }),
    /database write failed/,
  );
  assert.equal(store.rows.size, 0);

  const retried = await withIdempotency(input, async () => {
    runs++;
    return { id: 9 };
  });
  assert.deepEqual(retried, { id: 9 });
  assert.equal(runs, 2);
  assert.equal(store.rows.size, 1);
});

test("a concurrent call with the same key does not execute twice", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const input = { ...BASE, args: { name: "Task" } };

  const first = withIdempotency(input, async () => {
    runs++;
    started();
    await gate;
    return { id: 1 };
  });
  await running;
  await assert.rejects(
    withIdempotency(input, async () => {
      runs++;
      return { id: 2 };
    }),
    (error: unknown) =>
      error instanceof ApiError
      && error.status === 409
      && error.message === "idempotency key is already in progress",
  );
  assert.equal(runs, 1);
  release();
  assert.deepEqual(await first, { id: 1 });
  assert.equal(runs, 1);
});

test("invalid keys are rejected before running the tool", async (t) => {
  t.mock.method(db, "query", async () => assert.fail("invalid keys must not query the database"));
  let runs = 0;
  const run = async () => {
    runs++;
    return { id: 1 };
  };

  for (const key of ["", "x".repeat(MCP_IDEMPOTENCY_KEY_MAX_LENGTH + 1), 42 as unknown as string]) {
    await assert.rejects(
      withIdempotency({ ...BASE, key, args: {} }, run),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  }
  assert.equal(runs, 0);
});

test("the maximum key length is accepted", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  const result = await withIdempotency(
    { ...BASE, key: "x".repeat(MCP_IDEMPOTENCY_KEY_MAX_LENGTH), args: {} },
    async () => {
      runs++;
      return { id: 1 };
    },
  );
  assert.deepEqual(result, { id: 1 });
  assert.equal(runs, 1);
});

test("every reservation takes a fresh owner token that scopes its result write", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);

  await withIdempotency({ ...BASE, key: "owner-1", args: {} }, async () => ({ id: 1 }));
  await withIdempotency({ ...BASE, key: "owner-2", args: {} }, async () => ({ id: 2 }));

  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO mcp_idempotency"));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /owner_token = EXCLUDED\.owner_token/);
  assert.match(inserts[0].sql, /RETURNING id, owner_token/);
  const tokens = inserts.map((call) => call.params?.[6]);
  assert.equal(typeof tokens[0], "string");
  assert.equal(typeof tokens[1], "string");
  assert.notEqual(tokens[0], tokens[1]);

  const updates = calls.filter((call) => call.sql.includes("UPDATE mcp_idempotency SET response"));
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.match(update.sql, /WHERE id = \$1 AND owner_token = \$2/);
    assert.equal(typeof update.params?.[1], "string");
  }
});

test("a takeover keeps the new owner's response when the earlier run finishes", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });

  const result = await withIdempotency({ ...BASE, args: { name: "Task" } }, async () => {
    const row = [...store.rows.values()][0];
    // The stale window elapsed and another execution took over the row and
    // already recorded its own result before this run returned.
    row.ownerToken = "taken-over";
    row.response = { id: 2 };
    return { id: 1 };
  });

  assert.deepEqual(result, { id: 1 });
  const row = [...store.rows.values()][0];
  assert.equal(row.ownerToken, "taken-over");
  assert.deepEqual(row.response, { id: 2 });
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /was taken over/);
});

test("a late failure cannot delete the reservation taken over by another run", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);

  await assert.rejects(
    withIdempotency({ ...BASE, args: { name: "Task" } }, async () => {
      const row = [...store.rows.values()][0];
      row.ownerToken = "taken-over";
      row.response = { id: 2 };
      throw new Error("late failure");
    }),
    /late failure/,
  );

  assert.equal(store.rows.size, 1);
  const row = [...store.rows.values()][0];
  assert.equal(row.ownerToken, "taken-over");
  assert.deepEqual(row.response, { id: 2 });
});

/** A Queryable that forwards to the mocked pool, as a transaction client would. */
const tx = { query: (sql: string, params?: unknown[]) => db.query(sql, params) } as unknown as Queryable;

test("without a key the reservation hook is a no-op", async (t) => {
  t.mock.method(db, "query", async () => assert.fail("idempotency storage must not be used"));
  const result = await withIdempotency({ ...BASE, key: undefined, args: {} }, async (reservation) => {
    await reservation.recordCreatedTask(tx, 5);
    return { id: 5 };
  });
  assert.deepEqual(result, { id: 5 });
});

test("a takeover requires no recorded task and clears created_task_id", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  await withIdempotency({ ...BASE, args: {} }, async () => ({ id: 1 }));
  const insert = calls.find((call) => call.sql.includes("INSERT INTO mcp_idempotency"));
  assert.match(insert!.sql, /created_task_id = NULL/);
  assert.match(insert!.sql, /response IS NULL\s+AND mcp_idempotency\.created_task_id IS NULL/);
});

test("a failure after the task was recorded keeps the reservation", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  let runs = 0;
  const input = { ...BASE, args: { name: "Task" } };

  await assert.rejects(
    withIdempotency(input, async (reservation) => {
      runs++;
      await reservation.recordCreatedTask(tx, 77);
      throw new Error("audit failed after commit");
    }),
    /audit failed after commit/,
  );
  const row = [...store.rows.values()][0];
  assert.equal(row.createdTaskId, 77);
  assert.equal(row.response, null);

  // Before the stale window the first run may still be finishing.
  await assert.rejects(
    withIdempotency(input, async () => {
      runs++;
      return { id: 78 };
    }, { recover: async () => assert.fail("must not recover before the stale window") }),
    (error: unknown) => error instanceof ApiError && error.status === 409
      && error.message === "idempotency key is already in progress",
  );
  assert.equal(runs, 1);
});

test("a stale reservation with a created task is recovered, not run again or recorded", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  const input = { ...BASE, args: { name: "Task" } };
  await withIdempotency(input, async (reservation) => {
    await reservation.recordCreatedTask(tx, 77);
    throw new Error("crashed before the response");
  }).catch(() => undefined);
  [...store.rows.values()][0].stale = true;

  let runs = 0;
  const recovered: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await withIdempotency(input, async () => {
      runs++;
      return { id: 0 };
    }, {
      recover: async ({ createdTaskId }) => {
        recovered.push(createdTaskId);
        return { id: createdTaskId, recovered: true };
      },
    });
    assert.deepEqual(result, { id: 77, recovered: true });
  }
  assert.equal(runs, 0);
  assert.deepEqual(recovered, [77, 77]);
  assert.equal([...store.rows.values()][0].response, null, "recovery is never recorded");

  // Different arguments under the same key are still a conflict.
  await assert.rejects(
    withIdempotency({ ...BASE, args: { name: "Other" } }, async () => ({ id: 0 }), {
      recover: async () => assert.fail("must not recover a different request"),
    }),
    (error: unknown) => error instanceof ApiError && error.status === 409
      && error.message === "idempotency key reused with different arguments",
  );
});

test("a stale reservation without a recover callback stays in progress", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  const input = { ...BASE, args: {} };
  await withIdempotency(input, async (reservation) => {
    await reservation.recordCreatedTask(tx, 77);
    throw new Error("crashed");
  }).catch(() => undefined);
  [...store.rows.values()][0].stale = true;
  await assert.rejects(
    withIdempotency(input, async () => ({ id: 0 })),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
});

test("recording the task after a takeover fails so the creation rolls back", async (t) => {
  const calls: Call[] = [];
  const store = idempotencyStore(calls);
  t.mock.method(db, "query", store.query);
  await assert.rejects(
    withIdempotency({ ...BASE, args: {} }, async (reservation) => {
      [...store.rows.values()][0].ownerToken = "taken-over";
      await reservation.recordCreatedTask(tx, 77);
      return { id: 77 };
    }),
    (error: unknown) => error instanceof ApiError && error.status === 409
      && error.message === "idempotency key was taken over by another request",
  );
  const row = [...store.rows.values()][0];
  assert.equal(row.createdTaskId, null);
  assert.equal(row.ownerToken, "taken-over");
});
