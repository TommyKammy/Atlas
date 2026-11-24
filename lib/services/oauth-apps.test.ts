import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { ApiError } from "../api/errors";
import type { Queryable } from "../db";
import { listOAuthApps, revokeOAuthApp } from "./oauth-apps";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

const actor = { uid: 42, source: "web" } as const;
const FAMILY_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_FAMILY_ID = "00000000-0000-4000-8000-000000000002";

function mockQueries(
  options: {
    rows?: Record<string, unknown>[];
    owned?: boolean;
    userExists?: boolean;
    tokenUpdates?: number;
    refreshUpdates?: number;
  },
  calls: Call[],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM oauth_refresh_tokens") && sql.includes("WITH active")) {
        return result(options.rows ?? []);
      }
      if (sql.includes("SELECT family_id, workspace_id")) {
        return result(options.owned === false ? [] : [{
          family_id: params?.[0],
          workspace_id: 1,
        }]);
      }
      if (sql.includes("SELECT id FROM users WHERE id = $1::bigint FOR UPDATE")) {
        return result(options.userExists === false ? [] : [{ id: 42 }]);
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        return result([{ pg_advisory_xact_lock: null }]);
      }
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) {
        return result([], options.tokenUpdates ?? 2);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) {
        return result([], options.refreshUpdates ?? 1);
      }
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function assertNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, 404);
    assert.equal(error.message, "connection not found");
    return true;
  });
}

test("the connected-app list is scoped to the actor and maps display fields", async () => {
  const calls: Call[] = [];
  const q = mockQueries({
    rows: [{
      family_id: FAMILY_ID,
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      client_name: "Claude Code",
      scopes: ["read", "write"],
      resource: "https://atlas.test/mcp",
      first_authorized_at: "2026-11-20T00:00:00Z",
      last_used_at: "2026-11-24T00:00:00Z",
    }],
  }, calls);

  const apps = await listOAuthApps(actor, q);
  assert.equal(apps.length, 1);
  assert.deepEqual(apps[0], {
    family_id: FAMILY_ID,
    client_name: "Claude Code",
    client_host: "claude.ai",
    scopes: ["read", "write"],
    endpoint: "default",
    resource: "https://atlas.test/mcp",
    first_authorized_at: "2026-11-20T00:00:00Z",
    last_used_at: "2026-11-24T00:00:00Z",
  });
  assert.deepEqual(calls[0].params, [42]);
  assert.match(calls[0].sql, /WHERE user_id = \$1/);
  assert.match(calls[0].sql, /revoked_at IS NULL/);
  assert.match(calls[0].sql, /expires_at > now\(\)/);
  assert.match(calls[0].sql, /kind = 'oauth'/);
});

test("readonly connections and nameless DCR clients are labeled", async () => {
  const calls: Call[] = [];
  const q = mockQueries({
    rows: [{
      family_id: FAMILY_ID,
      client_id: "atlas_oauth_opaque",
      client_name: null,
      scopes: ["read"],
      resource: "https://atlas.test/mcp/readonly",
      first_authorized_at: "2026-11-20T00:00:00Z",
      last_used_at: null,
    }],
  }, calls);

  const apps = await listOAuthApps(actor, q);
  assert.equal(apps[0].client_name, "動的に登録されたアプリ");
  assert.equal(apps[0].client_host, null);
  assert.equal(apps[0].endpoint, "readonly");
  assert.equal(apps[0].last_used_at, null);
});

test("revoking a connection expires every token in the actor's family", async () => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  const revoked = await revokeOAuthApp(actor, FAMILY_ID, q);
  assert.deepEqual(revoked, { family_id: FAMILY_ID });

  const access = calls.find((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at"));
  assert.ok(access);
  assert.deepEqual(access.params, [FAMILY_ID, 42]);
  assert.match(access.sql, /oauth_family_id = \$1::uuid/);
  assert.match(access.sql, /user_id = \$2/);

  const familyLock = calls.findIndex((call) => call.sql.includes("pg_advisory_xact_lock"));
  const userLock = calls.findIndex(
    (call) => call.sql.includes("SELECT id FROM users WHERE id = $1::bigint FOR UPDATE"),
  );
  const accessIndex = calls.indexOf(access);
  const refreshIndex = calls.findIndex((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at"));
  assert.ok(userLock >= 0, "revocation must lock the actor's user row");
  assert.ok(familyLock >= 0, "revocation must take the family advisory lock");
  assert.ok(userLock < familyLock, "the user row lock must precede the family lock");
  assert.ok(accessIndex > familyLock, "access tokens must be updated after the family lock");
  assert.ok(refreshIndex > familyLock, "refresh tokens must be updated after the family lock");
  assert.deepEqual(calls[userLock].params, [42]);
  assert.deepEqual(calls[familyLock].params, [FAMILY_ID]);

  const refresh = calls.find((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at"));
  assert.ok(refresh);
  assert.deepEqual(refresh.params, [FAMILY_ID, 42]);
  assert.match(refresh.sql, /family_id = \$1::uuid/);
  assert.match(refresh.sql, /user_id = \$2/);

  const audit = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit);
  assert.equal(audit.params?.[0], 1);
  assert.equal(audit.params?.[1], 42);
  assert.equal(audit.params?.[2], "mcp.oauth.revoke");
});

test("another user's family is reported as missing and is never revoked", async () => {
  const calls: Call[] = [];
  const q = mockQueries({ owned: false }, calls);
  await assertNotFound(revokeOAuthApp(actor, OTHER_FAMILY_ID, q));
  assert.ok(!calls.some((call) => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")));
});

test("a missing actor row is reported as missing and is never revoked", async () => {
  const calls: Call[] = [];
  const q = mockQueries({ userExists: false }, calls);
  await assertNotFound(revokeOAuthApp(actor, FAMILY_ID, q));
  assert.ok(!calls.some((call) => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")));
});

test("a malformed family id is not queried", async () => {
  const calls: Call[] = [];
  const q = mockQueries({}, calls);
  await assertNotFound(revokeOAuthApp(actor, "../../etc/passwd", q));
  assert.equal(calls.length, 0);
});
