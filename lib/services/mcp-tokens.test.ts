import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { ApiError } from "../api/errors";
import { db, type Queryable } from "../db";
import { hashMcpToken, isMcpToken } from "../mcp/token";
import { revokeSessionsAndMcpTokens, setUserDeactivated } from "./admin-user-access";
import {
  createPersonalTokenInTransaction,
  listPersonalTokens,
  revokeAllUserTokens,
  revokePersonalToken,
} from "./mcp-tokens";

type Call = { sql: string; params?: unknown[] };

type MockOptions = {
  guest?: boolean;
  deactivated?: boolean;
  hasSettings?: boolean;
  mcpEnabled?: boolean;
  patEnabled?: boolean;
  listRows?: Record<string, unknown>[];
  revokeCount?: number;
  existingToken?: boolean;
  revokeAllCount?: number;
};

function result(rows: Record<string, unknown>[], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

/** Minimal Queryable for the actor guard, workspace switches and token writes. */
function mockQueries(options: MockOptions, calls: Call[]): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        return result([{ window_id: "00000000-0000-0000-0000-000000000001" }]);
      }
      if (sql.includes("FROM users u")) {
        return result([{
          is_admin: false,
          is_guest: options.guest === true,
          deactivated_at: options.deactivated ? "2026-01-01T00:00:00Z" : null,
        }]);
      }
      if (sql.includes("FROM workspace_security")) {
        return options.hasSettings === false
          ? result([])
          : result([{
              workspace_id: 1,
              mcp_enabled: options.mcpEnabled !== false,
              mcp_pat_enabled: options.patEnabled !== false,
            }]);
      }
      if (sql.includes("INSERT INTO mcp_tokens")) {
        return result([{
          id: 9,
          name: params?.[2],
          scopes: params?.[4],
          created_at: "2026-11-22T00:00:00Z",
        }]);
      }
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      if (sql.includes("FROM mcp_tokens") && sql.includes("ORDER BY id DESC")) {
        return result(options.listRows ?? []);
      }
      if (sql.includes("WHERE user_id = $1 AND revoked_at IS NULL")) {
        return result([], options.revokeAllCount ?? 0);
      }
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) {
        return result([{ id: Number(params?.[0]), workspace_id: 1 }], options.revokeCount ?? 1);
      }
      if (sql.includes("SELECT id FROM mcp_tokens")) {
        return result(options.existingToken ? [{ id: Number(params?.[0]) }] : []);
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const actor = { uid: 42, source: "web" } as const;

/** Queryable for the deactivation transaction SQL. */
function deactivationQueryable(calls: Call[]): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM workspace_roles WHERE is_super")) return result([]);
      if (sql.includes("SELECT id, deactivated_at FROM users")) {
        return result([{ id: 7, deactivated_at: null }]);
      }
      if (sql.includes("LEFT JOIN workspace_roles")) {
        return result([{
          id: 7,
          is_admin: false,
          is_guest: false,
          role_id: null,
          key: null,
          name: null,
          base_level: null,
          permissions: null,
          is_super: false,
        }]);
      }
      if (sql.includes("UPDATE users SET deactivated_at")) {
        return result([{
          id: 7,
          deactivated_at: params?.[1] ? "2026-11-22T00:00:00Z" : null,
        }]);
      }
      if (sql.includes("DELETE FROM user_sessions")) return result([]);
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) return result([{ id: 3 }], 1);
      throw new Error(`unexpected query: ${sql}`);
    },
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

test("guests cannot issue personal tokens", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({ guest: true }, calls);
  t.mock.method(db, "query", q.query);
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" }),
    403,
    "guest users cannot use MCP",
    "forbidden",
  );
  assert.ok(!calls.some((call) => call.sql.includes("workspace_security")));
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO mcp_tokens")));
});

test("deactivated users cannot issue personal tokens after the row lock", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({ deactivated: true }, calls);
  t.mock.method(db, "query", q.query);
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" }),
    403,
    "unknown or inactive user",
    "forbidden",
  );
  assert.match(calls[0].sql, /FROM users u[\s\S]*FOR UPDATE/);
  assert.ok(!calls.some((call) => call.sql.includes("workspace_security")));
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO mcp_tokens")));
});

test("PAT issuance locks the user row before inserting the token", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  t.mock.method(db, "query", q.query);
  await createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" });
  const lockIndex = calls.findIndex(
    (call) => call.sql.includes("FROM users u") && call.sql.includes("FOR UPDATE"),
  );
  const insertIndex = calls.findIndex((call) => call.sql.includes("INSERT INTO mcp_tokens"));
  assert.equal(lockIndex, 0);
  assert.ok(insertIndex > lockIndex);
  assert.deepEqual(calls[lockIndex].params, [42]);
});

test("PAT issuance writes its audit row through the transaction Queryable", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  const dbCalls: Call[] = [];
  t.mock.method(db, "query", async (sql: string, params?: unknown[]) => {
    dbCalls.push({ sql, params });
    throw new Error("PAT issuance must use the transaction Queryable");
  });
  await createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" });
  const auditCall = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(auditCall);
  assert.equal(auditCall.params?.[0], 1);
  assert.equal(auditCall.params?.[1], 42);
  assert.equal(auditCall.params?.[2], "mcp.token.create");
  assert.equal(dbCalls.length, 0);
});

test("token issuance requires both MCP workspace switches", async (t) => {
  const calls: Call[] = [];
  const options: MockOptions = { mcpEnabled: false };
  const q = mockQueries(options, calls);
  t.mock.method(db, "query", q.query);
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" }),
    403,
    "MCP personal access tokens are disabled",
    "forbidden",
  );
  options.mcpEnabled = true;
  options.patEnabled = false;
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" }),
    403,
    "MCP personal access tokens are disabled",
    "forbidden",
  );
  options.hasSettings = false;
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop", access: "read" }),
    403,
    "MCP personal access tokens are disabled",
    "forbidden",
  );
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO mcp_tokens")));
});

test("token issuance validates the name and access after the workspace switches", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  t.mock.method(db, "query", q.query);
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { access: "read" }),
    400,
    "name is required",
    "bad_request",
  );
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "   ", access: "read" }),
    400,
    "name is required",
    "bad_request",
  );
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "n".repeat(101), access: "read" }),
    400,
    "name must be 100 characters or fewer",
    "bad_request",
  );
  await assertApiError(
    createPersonalTokenInTransaction(q, actor, { name: "Laptop" }),
    400,
    "access must be read or read_write",
    "bad_request",
  );
});

test("createPersonalToken stores only the hash and returns the plaintext once", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  t.mock.method(db, "query", q.query);
  const created = await createPersonalTokenInTransaction(q, actor, {
    name: "  Laptop  ",
    access: "read_write",
  });
  assert.equal(created.id, 9);
  assert.equal(created.name, "Laptop");
  assert.deepEqual(created.scopes, ["read", "write"]);
  assert.equal(created.created_at, "2026-11-22T00:00:00Z");
  assert.equal(isMcpToken(created.token), true);

  const insert = calls.find((call) => call.sql.includes("INSERT INTO mcp_tokens"));
  assert.ok(insert);
  assert.deepEqual(insert.params?.slice(0, 3), [1, 42, "Laptop"]);
  assert.equal(insert.params?.[3], hashMcpToken(created.token));
  assert.notEqual(insert.params?.[3], created.token);
  assert.deepEqual(insert.params?.[4], ["read", "write"]);
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO audit_log")));
});

test("read access issues only the read scope", async (t) => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  t.mock.method(db, "query", q.query);
  const created = await createPersonalTokenInTransaction(q, actor, {
    name: "Phone",
    access: "read",
  });
  assert.deepEqual(created.scopes, ["read"]);
});

test("listPersonalTokens returns only safe PAT fields", async (t) => {
  const calls: Call[] = [];
  const rows = [{
    id: 9,
    name: "Laptop",
    scopes: ["read"],
    client_name: null,
    created_at: "2026-11-22T00:00:00Z",
    last_used_at: "2026-11-22T01:00:00Z",
    revoked_at: null,
  }];
  t.mock.method(db, "query", mockQueries({ listRows: rows }, calls).query);
  assert.deepEqual(await listPersonalTokens(actor), rows);
  const query = calls[0].sql;
  assert.ok(query.includes("kind = 'pat'"));
  assert.ok(query.includes("last_used_at"));
  assert.ok(!query.includes("token_hash"));
});

test("revokePersonalToken revokes only the actor's PAT and is idempotent", async (t) => {
  const calls: Call[] = [];
  const options: MockOptions = { revokeCount: 1 };
  t.mock.method(db, "query", mockQueries(options, calls).query);
  assert.deepEqual(await revokePersonalToken(actor, 9), { id: 9 });
  assert.deepEqual(calls[0].params, [9, 42]);
  const revokeAudit = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(revokeAudit);
  // The audit screen filters by workspace_id, so the revocation must carry it.
  assert.equal(revokeAudit.params?.[0], 1);
  assert.equal(revokeAudit.params?.[2], "mcp.token.revoke");
  assert.equal(revokeAudit.params?.[4], 9);

  options.revokeCount = 0;
  options.existingToken = false;
  await assertApiError(revokePersonalToken(actor, 10), 404, "token not found", "not_found");

  options.existingToken = true;
  assert.deepEqual(await revokePersonalToken(actor, 9), { id: 9 });
});

test("revokePersonalToken rejects malformed ids without querying", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({}, calls).query);
  await assertApiError(revokePersonalToken(actor, 0), 404, "token not found", "not_found");
  await assertApiError(revokePersonalToken(actor, Number.NaN), 404, "token not found", "not_found");
  assert.equal(calls.length, 0);
});

test("revokeAllUserTokens revokes PAT and OAuth rows for one user", async () => {
  const calls: Call[] = [];
  const count = await revokeAllUserTokens(7, mockQueries({ revokeAllCount: 3 }, calls));
  assert.equal(count, 3);
  assert.deepEqual(calls[0].params, [7]);
  assert.ok(calls[0].sql.includes("UPDATE mcp_tokens SET revoked_at = now()"));
  assert.ok(!calls[0].sql.includes("kind ="));
});

test("setUserDeactivated revokes every MCP token in the same transaction", async () => {
  const calls: Call[] = [];
  const result = await setUserDeactivated(deactivationQueryable(calls), 7, true);
  assert.equal(result.deactivated_at, "2026-11-22T00:00:00Z");
  assert.ok(calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
  assert.deepEqual(
    calls.find((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at"))?.params,
    [7],
  );

  const reactivateCalls: Call[] = [];
  await setUserDeactivated(deactivationQueryable(reactivateCalls), 7, false);
  assert.ok(!reactivateCalls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
});

test("password and 2FA resets revoke MCP tokens on the reset transaction", async () => {
  const passwordCalls: Call[] = [];
  await revokeSessionsAndMcpTokens(deactivationQueryable(passwordCalls), 7, {
    preserveSessionTokenHash: "keep-this-session",
  });
  assert.match(passwordCalls[0].sql, /DELETE FROM user_sessions/);
  assert.deepEqual(passwordCalls[0].params, [7, "keep-this-session"]);
  assert.match(passwordCalls[1].sql, /UPDATE mcp_tokens SET revoked_at/);
  assert.deepEqual(passwordCalls[1].params, [7]);

  const mfaCalls: Call[] = [];
  await revokeSessionsAndMcpTokens(deactivationQueryable(mfaCalls), 7, {
    deleteAllSessions: true,
  });
  assert.match(mfaCalls[0].sql, /DELETE FROM user_sessions WHERE user_id = \$1$/);
  assert.deepEqual(mfaCalls[0].params, [7]);
  assert.match(mfaCalls[1].sql, /UPDATE mcp_tokens SET revoked_at/);
  assert.deepEqual(mfaCalls[1].params, [7]);
});

test("npm test runs the MCP test files", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.ok(
    (pkg.scripts?.test ?? "").includes("lib/mcp/*.test.ts"),
    "package.json test script must include lib/mcp/*.test.ts",
  );
});
