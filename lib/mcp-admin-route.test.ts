import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { db } from "./db";
import { ALL_PERMISSIONS } from "./permission-catalog";

type Call = { sql: string; params?: unknown[] };

const WORKSPACE_ID = 7;
const ACTOR_ID = 42;

function result(rows: QueryResultRow[], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

type AuthOptions = {
  isSuper?: boolean;
  permissions?: readonly string[];
};

function sessionRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: `atlas_session=${"a".repeat(43)}` },
  });
}

/** Auth, workspace settings, and route-specific reads for request-bound handlers. */
function mockDbQueries(
  calls: Call[],
  options: AuthOptions,
  routeRead: (sql: string, params?: unknown[]) => QueryResult | null,
) {
  return async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (sql.includes("FROM user_sessions")) {
      return result([{
        id: ACTOR_ID,
        name: "Admin",
        email: "admin@example.com",
        is_admin: true,
        is_guest: false,
        totp_enabled: false,
        mfa_pending: false,
      }]);
    }
    if (sql.includes("FROM users u") && sql.includes("LEFT JOIN workspace_roles")) {
      return result([{
        id: ACTOR_ID,
        is_admin: true,
        is_guest: false,
        role_id: 1,
        key: "owner",
        name: "オーナー",
        base_level: "admin",
        permissions: options.permissions ?? ALL_PERMISSIONS,
        is_super: options.isSuper !== false,
      }]);
    }
    if (sql.includes("SELECT id FROM workspaces")) return result([{ id: WORKSPACE_ID }]);
    if (sql.includes("INSERT INTO workspace_security")) return result([]);
    if (sql.includes("FROM workspace_security WHERE workspace_id")) {
      return result([{ workspace_id: WORKSPACE_ID }]);
    }
    const route = routeRead(sql, params);
    if (route) return route;
    throw new Error(`unexpected query: ${sql}`);
  };
}

function mockTransactionClient(
  calls: Call[],
  routeWrite: (sql: string, params?: unknown[]) => QueryResult | null,
): PoolClient {
  const client = {
    query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result([]);
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      const route = routeWrite(sql, params);
      if (route) return route;
      throw new Error(`unexpected query: ${sql}`);
    },
    release: () => undefined,
  };
  return client as unknown as PoolClient;
}

function singleTokenRow(): Record<string, unknown> {
  return {
    kind: "pat",
    id: 9,
    user_id: 42,
    user_name: "山田 太郎",
    user_email: "taro@example.com",
    name: "Laptop",
    scopes: ["read"],
    read_only: true,
    created_at: "2026-11-19T00:00:00Z",
    last_used_at: "2026-11-20T00:00:00Z",
  };
}

test("the admin token list is restricted to super administrators", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, { isSuper: false }, () => null));

  const { GET } = await import("../app/api/admin/mcp/tokens/route");
  const response = await GET(sessionRequest("/api/admin/mcp/tokens"));

  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "super administrator required");
  assert.ok(!calls.some((call) => call.sql.includes("FROM mcp_tokens t")));
});

test("the admin token list is scoped to the current workspace", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, (sql, params) => {
    if (sql.includes("WITH family_rows AS")) return result([], 0);
    if (sql.includes("FROM mcp_tokens t") && sql.includes("AND t.kind = 'pat'")) {
      assert.deepEqual(params, [WORKSPACE_ID]);
      return result([singleTokenRow()], 1);
    }
    return null;
  }));

  const { GET } = await import("../app/api/admin/mcp/tokens/route");
  const response = await GET(sessionRequest("/api/admin/mcp/tokens"));

  assert.equal(response.status, 200);
  const body = await response.json() as { tokens: Array<{ kind: string; name?: string }> };
  assert.equal(body.tokens.length, 1);
  assert.equal(body.tokens[0].kind, "pat");
  assert.equal(body.tokens[0].name, "Laptop");
});

test("the request log rejects unknown outcome filters before reading rows", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, () => null));

  const { GET } = await import("../app/api/admin/mcp/logs/route");
  const response = await GET(sessionRequest("/api/admin/mcp/logs?outcome=success"));

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.match(body.error, /outcome must be/);
  assert.ok(!calls.some((call) => call.sql.includes("FROM mcp_request_log")));
});

test("the request log rejects malformed cursors", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, () => null));

  const { GET } = await import("../app/api/admin/mcp/logs/route");
  for (const cursor of ["abc", "0", "-1", "1.5"]) {
    const response = await GET(sessionRequest(`/api/admin/mcp/logs?outcome=all&cursor=${cursor}`));
    assert.equal(response.status, 400, cursor);
  }
  assert.ok(!calls.some((call) => call.sql.includes("FROM mcp_request_log")));
});

test("the request log forwards the outcome filter and cursor with page size 50", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, (sql, params) => {
    if (sql.includes("FROM mcp_request_log l")) {
      assert.deepEqual(params, [WORKSPACE_ID, "denied", 99]);
      return result([{
        id: 98,
        token_id: 5,
        token_name: "Laptop",
        user_id: 42,
        user_name: "山田 太郎",
        user_email: "taro@example.com",
        endpoint: "default",
        rpc_method: "tools/call",
        tool_name: "list_projects",
        outcome: "denied",
        error_code: "forbidden",
        duration_ms: 8,
        client_name: "Claude Code",
        client_ip: "127.0.0.1",
        created_at: "2026-11-24T00:00:00Z",
      }], 1);
    }
    return null;
  }));

  const { GET } = await import("../app/api/admin/mcp/logs/route");
  const response = await GET(sessionRequest("/api/admin/mcp/logs?outcome=denied&cursor=99"));

  assert.equal(response.status, 200);
  const body = await response.json() as {
    logs: Array<{ outcome: string; token_name: string }>;
    next_cursor: number | null;
    page_size: number;
  };
  assert.equal(body.page_size, 50);
  assert.equal(body.next_cursor, null);
  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0].outcome, "denied");
  assert.equal(body.logs[0].token_name, "Laptop");
});

test("the PAT revoke route reports a missing token as 404", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, () => null));

  // lib/db awaits next/server connection() before opening the pool client.
  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);
  t.mock.method(Pool.prototype, "connect", async () => mockTransactionClient([], (sql) => {
    if (sql.includes("SELECT t.user_id") && sql.includes("FROM mcp_tokens t")) return result([], 0);
    if (sql.includes("UPDATE mcp_tokens t SET revoked_at")) return result([], 0);
    return null;
  }));

  const { DELETE } = await import("../app/api/admin/mcp/tokens/pat/[id]/route");
  const response = await DELETE(
    sessionRequest("/api/admin/mcp/tokens/pat/9", "DELETE"),
    { params: Promise.resolve({ id: "9" }) },
  );

  assert.equal(response.status, 404);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "token not found");
});

test("the PAT revoke route audits a successful revocation", async (t) => {
  const calls: Call[] = [];
  const clientCalls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, () => null));

  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);
  t.mock.method(Pool.prototype, "connect", async () => mockTransactionClient(clientCalls, (sql, params) => {
    if (sql.includes("SELECT t.user_id") && sql.includes("FROM mcp_tokens t")) {
      return result([{ user_id: 42 }], 1);
    }
    if (sql.includes("SELECT id FROM users WHERE id = ANY($1::bigint[])")) {
      const ids = (params?.[0] as number[]) ?? [];
      return result(ids.map((id) => ({ id })), ids.length);
    }
    if (sql.includes("UPDATE mcp_tokens t SET revoked_at")) {
      return result([{
        id: Number(params?.[0]),
        name: "Laptop",
        user_id: 42,
        user_name: "山田 太郎",
        user_email: "taro@example.com",
      }], 1);
    }
    return null;
  }));

  const { DELETE } = await import("../app/api/admin/mcp/tokens/pat/[id]/route");
  const response = await DELETE(
    sessionRequest("/api/admin/mcp/tokens/pat/9", "DELETE"),
    { params: Promise.resolve({ id: "9" }) },
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { revoked: number };
  assert.equal(body.revoked, 9);
  const audit = clientCalls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit);
  assert.equal(audit.params?.[1], ACTOR_ID);
  assert.equal(audit.params?.[2], "mcp.token.admin_revoke");
});

test("the OAuth revoke route forwards the family id and logs the target user", async (t) => {
  const FAMILY_ID = "00000000-0000-4000-8000-000000000001";
  const calls: Call[] = [];
  const clientCalls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(calls, {}, () => null));

  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);
  t.mock.method(Pool.prototype, "connect", async () => mockTransactionClient(clientCalls, (sql, params) => {
    if (sql.includes("SELECT owner.user_id")) {
      return result([{
        user_id: 42,
        client_name: "Claude Code",
        user_name: "山田 太郎",
        user_email: "taro@example.com",
      }], 1);
    }
    if (sql.includes("SELECT id FROM users WHERE id = ANY($1::bigint[])")) {
      assert.deepEqual(params, [[42]]);
      return result([{ id: 42 }], 1);
    }
    if (sql.includes("pg_advisory_xact_lock")) return result([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("UPDATE mcp_tokens SET revoked_at")) return result([], 2);
    if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) return result([], 1);
    return null;
  }));

  const { DELETE } = await import("../app/api/admin/mcp/tokens/oauth/[familyId]/route");
  const response = await DELETE(
    sessionRequest(`/api/admin/mcp/tokens/oauth/${FAMILY_ID}`, "DELETE"),
    { params: Promise.resolve({ familyId: FAMILY_ID }) },
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { revoked: string };
  assert.equal(body.revoked, FAMILY_ID);
  const audit = clientCalls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit);
  assert.equal(audit.params?.[1], ACTOR_ID);
  assert.equal(audit.params?.[2], "mcp.oauth.admin_revoke");
  assert.match(String(audit.params?.[6]), /山田 太郎/);
});
