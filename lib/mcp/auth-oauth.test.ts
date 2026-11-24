import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "@/lib/db";
import { generateOAuthAccessToken, generateOAuthRefreshToken } from "@/lib/oauth/tokens";
import { authenticateMcpToken } from "./auth";
import { generateMcpToken, hashMcpToken } from "./token";

process.env.APP_URL = "https://atlas.example";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

function mockQueryable(options: { token?: Record<string, unknown> | null }, calls: Call[] = []): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM mcp_tokens t")) return result(options.token ? [options.token] : []);
      if (sql.includes("DELETE FROM auth_rate_limits")) return result([]);
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        return result([{ window_id: "00000000-0000-0000-0000-000000000001" }]);
      }
      if (sql.includes("SELECT greatest")) return result([{ retry_after: 12 }]);
      if (sql.includes("UPDATE mcp_tokens SET last_used_at")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function request(authorization?: string): Request {
  return new Request("https://atlas.example/mcp", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

const ACCESS_TOKEN = generateOAuthAccessToken();

function oauthRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 71,
    workspace_id: 1,
    user_id: 42,
    kind: "oauth",
    token_hash: hashMcpToken(ACCESS_TOKEN),
    scopes: ["read", "write"],
    client_name: "Codex",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    last_used_at: new Date(),
    revoked_at: null,
    resource: "https://atlas.example/mcp",
    mcp_enabled: true,
    // OAuth must not depend on the PAT switch.
    mcp_pat_enabled: false,
    user_exists: true,
    deactivated_at: null,
    is_guest: false,
    ...overrides,
  };
}

test("a valid OAuth access token authenticates without the PAT switch", async () => {
  const auth = await authenticateMcpToken(
    request(`Bearer ${ACCESS_TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: oauthRow() }),
  );
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.kind, "oauth");
    assert.equal(auth.tokenId, 71);
    assert.equal(auth.clientName, "Codex");
    assert.deepEqual(auth.scopes, ["read", "write"]);
  }
});

test("an OAuth token for /mcp is rejected by /mcp/readonly", async () => {
  const auth = await authenticateMcpToken(
    request(`Bearer ${ACCESS_TOKEN}`),
    { endpoint: "readonly" },
    mockQueryable({ token: oauthRow() }),
  );
  assert.deepEqual(auth, { ok: false, reason: "audience" });
});

test("an OAuth token for /mcp/readonly works only on the readonly endpoint", async () => {
  const readonlyToken = generateOAuthAccessToken();
  const row = oauthRow({
    token_hash: hashMcpToken(readonlyToken),
    resource: "https://atlas.example/mcp/readonly",
    scopes: ["read"],
  });
  const readonly = await authenticateMcpToken(
    request(`Bearer ${readonlyToken}`),
    { endpoint: "readonly" },
    mockQueryable({ token: row }),
  );
  assert.equal(readonly.ok, true);

  const wrongEndpoint = await authenticateMcpToken(
    request(`Bearer ${readonlyToken}`),
    { endpoint: "default" },
    mockQueryable({ token: row }),
  );
  assert.deepEqual(wrongEndpoint, { ok: false, reason: "audience" });
});

test("the readonly endpoint narrows an OAuth token's write scope", async () => {
  const token = generateOAuthAccessToken();
  const auth = await authenticateMcpToken(
    request(`Bearer ${token}`),
    { endpoint: "readonly" },
    mockQueryable({
      token: oauthRow({
        token_hash: hashMcpToken(token),
        resource: "https://atlas.example/mcp/readonly",
      }),
    }),
  );
  assert.equal(auth.ok, true);
  if (auth.ok) assert.deepEqual(auth.scopes, ["read"]);
});

test("an expired OAuth token is rejected even with a matching audience", async () => {
  const auth = await authenticateMcpToken(
    request(`Bearer ${ACCESS_TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: oauthRow({ expires_at: new Date(Date.now() - 1_000).toISOString() }) }),
  );
  assert.deepEqual(auth, { ok: false, reason: "expired" });
});

test("an OAuth token without a resource fails the audience check", async () => {
  const auth = await authenticateMcpToken(
    request(`Bearer ${ACCESS_TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: oauthRow({ resource: null }) }),
  );
  assert.deepEqual(auth, { ok: false, reason: "audience" });
});

test("a refresh token is not accepted as an access token", async () => {
  const refresh = generateOAuthRefreshToken();
  const calls: Call[] = [];
  const auth = await authenticateMcpToken(
    request(`Bearer ${refresh}`),
    { endpoint: "default" },
    mockQueryable({ token: null }, calls),
  );
  assert.deepEqual(auth, { ok: false, reason: "invalid" });
  assert.equal(auth.ok, false);
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO auth_rate_limits")));
});

test("PATs keep their existing behaviour and ignore resource", async () => {
  const pat = generateMcpToken();
  const auth = await authenticateMcpToken(
    request(`Bearer ${pat}`),
    { endpoint: "default" },
    mockQueryable({
      token: oauthRow({
        kind: "pat",
        token_hash: hashMcpToken(pat),
        expires_at: null,
        resource: "https://atlas.example/mcp/readonly",
        mcp_pat_enabled: true,
      }),
    }),
  );
  assert.equal(auth.ok, true);
  if (auth.ok) assert.equal(auth.kind, "pat");
});

test("a revoked OAuth token is rejected before the audience check", async () => {
  const auth = await authenticateMcpToken(
    request(`Bearer ${ACCESS_TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: oauthRow({ revoked_at: new Date().toISOString() }) }),
  );
  assert.deepEqual(auth, { ok: false, reason: "revoked" });
});
