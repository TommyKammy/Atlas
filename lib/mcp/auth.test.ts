import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { AuthRateLimitError } from "@/lib/auth-rate-limit";
import type { Queryable } from "@/lib/db";
import { authenticateMcpToken } from "./auth";
import { generateMcpToken, hashMcpToken } from "./token";

process.env.APP_URL = "https://atlas.example";

type Call = { sql: string; params?: unknown[] };

type MockOptions = {
  token?: Record<string, unknown> | null;
  rateLimited?: boolean;
};

function result(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

/**
 * Minimal Queryable covering the token lookup, last_used_at update and the
 * failure-only auth rate limiter.
 */
function mockQueryable(options: MockOptions, calls: Call[]): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM mcp_tokens t")) {
        return result(options.token ? [options.token] : []);
      }
      if (sql.includes("DELETE FROM auth_rate_limits")) return result([]);
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        return result(options.rateLimited ? [] : [{ window_id: "00000000-0000-0000-0000-000000000001" }]);
      }
      if (sql.includes("SELECT greatest")) return result([{ retry_after: 12 }]);
      if (sql.includes("UPDATE mcp_tokens SET last_used_at")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const TOKEN = generateMcpToken();
const TOKEN_HASH = hashMcpToken(TOKEN);

function tokenRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    workspace_id: 1,
    user_id: 42,
    kind: "pat",
    token_hash: TOKEN_HASH,
    scopes: ["read", "write"],
    client_name: null,
    expires_at: null,
    last_used_at: new Date(),
    revoked_at: null,
    resource: "https://atlas.example/mcp",
    mcp_enabled: true,
    mcp_pat_enabled: true,
    user_exists: true,
    deactivated_at: null,
    is_guest: false,
    ...overrides,
  };
}

function request(authorization?: string): Request {
  return new Request("https://atlas.example/mcp", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

function authFailures(calls: Call[]): number {
  return calls.filter((call) => call.sql.includes("INSERT INTO auth_rate_limits")).length;
}

test("a valid PAT authenticates as a source=mcp actor", async () => {
  const calls: Call[] = [];
  const auth = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow({ client_name: "Claude Code" }) }, calls),
  );
  assert.deepEqual(auth, {
    ok: true,
    tokenId: 7,
    workspaceId: 1,
    userId: 42,
    kind: "pat",
    scopes: ["read", "write"],
    clientName: "Claude Code",
    actor: { uid: 42, source: "mcp", tokenId: 7, clientName: "Claude Code" },
  });
  assert.equal(authFailures(calls), 0);
});

test("the readonly endpoint narrows effective scopes to read", async () => {
  const writable = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow() }, []),
  );
  assert.equal(writable.ok, true);
  if (writable.ok) assert.deepEqual(writable.scopes, ["read", "write"]);

  const readonly = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "readonly" },
    mockQueryable({ token: tokenRow() }, []),
  );
  assert.equal(readonly.ok, true);
  if (readonly.ok) {
    assert.deepEqual(readonly.scopes, ["read"]);
    assert.equal(readonly.actor.source, "mcp");
  }
});

test("missing, malformed and unknown tokens are invalid and consume one failure", async () => {
  const cases: Array<string | undefined> = [
    undefined,
    "Basic abc",
    "Bearer atlas_mcp_short",
    `Bearer ${generateMcpToken()}`,
  ];
  for (const authorization of cases) {
    const calls: Call[] = [];
    const auth = await authenticateMcpToken(
      request(authorization),
      { endpoint: "default" },
      mockQueryable({ token: authorization ? tokenRow({ token_hash: TOKEN_HASH }) : null }, calls),
    );
    assert.deepEqual(auth, { ok: false, reason: "invalid" });
    assert.equal(authFailures(calls), 1);
  }
});

test("revocation, expiry, workspace switches, inactive users and guests have distinct reasons", async () => {
  const cases: Array<{ name: string; row: Record<string, unknown>; reason: string }> = [
    { name: "revoked", row: tokenRow({ revoked_at: "2026-01-01T00:00:00Z" }), reason: "revoked" },
    { name: "expired", row: tokenRow({ kind: "oauth", expires_at: "2020-01-01T00:00:00Z" }), reason: "expired" },
    { name: "workspace MCP disabled", row: tokenRow({ mcp_enabled: false }), reason: "disabled" },
    { name: "PAT switch disabled", row: tokenRow({ mcp_pat_enabled: false }), reason: "disabled" },
    { name: "deleted user", row: tokenRow({ user_exists: false }), reason: "inactive_user" },
    { name: "deactivated user", row: tokenRow({ deactivated_at: "2026-01-01T00:00:00Z" }), reason: "inactive_user" },
    { name: "guest", row: tokenRow({ is_guest: true }), reason: "guest" },
    { name: "malformed scopes", row: tokenRow({ scopes: ["write"] }), reason: "invalid" },
  ];
  for (const { name, row, reason } of cases) {
    const calls: Call[] = [];
    const auth = await authenticateMcpToken(
      request(`Bearer ${TOKEN}`),
      { endpoint: "default" },
      mockQueryable({ token: row }, calls),
    );
    assert.deepEqual(auth, { ok: false, reason }, name);
    assert.equal(authFailures(calls), 1, name);
  }
});

test("PATs never expire; OAuth tokens require a future expires_at", async () => {
  const pat = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow({ expires_at: null }) }, []),
  );
  assert.equal(pat.ok, true);

  const oauth = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({
      token: tokenRow({
        kind: "oauth",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        mcp_pat_enabled: false,
      }),
    }, []),
  );
  assert.equal(oauth.ok, true);
  if (oauth.ok) assert.equal(oauth.kind, "oauth");

  const missingExpiry = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow({ kind: "oauth", expires_at: null }) }, []),
  );
  assert.deepEqual(missingExpiry, { ok: false, reason: "expired" });
});

test("last_used_at is refreshed only when stale and success never consumes the failure budget", async () => {
  const staleCalls: Call[] = [];
  const stale = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow({ last_used_at: null }) }, staleCalls),
  );
  assert.equal(stale.ok, true);
  assert.ok(staleCalls.some((call) => call.sql.includes("UPDATE mcp_tokens SET last_used_at")));
  assert.equal(authFailures(staleCalls), 0);

  const recentCalls: Call[] = [];
  const recent = await authenticateMcpToken(
    request(`Bearer ${TOKEN}`),
    { endpoint: "default" },
    mockQueryable({ token: tokenRow({ last_used_at: new Date() }) }, recentCalls),
  );
  assert.equal(recent.ok, true);
  assert.ok(!recentCalls.some((call) => call.sql.includes("UPDATE mcp_tokens SET last_used_at")));
  assert.equal(authFailures(recentCalls), 0);
});

test("a tripped IP limit fails the request with a 429 error instead of a token reason", async () => {
  await assert.rejects(
    authenticateMcpToken(
      request("Bearer atlas_mcp_short"),
      { endpoint: "default" },
      mockQueryable({ rateLimited: true }, []),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AuthRateLimitError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 12);
      return true;
    },
  );
});
