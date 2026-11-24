import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { ApiError } from "../api/errors";
import type { Queryable } from "../db";
import {
  isMcpLogOutcomeFilter,
  listAdminMcpRequestLogs,
  listAdminMcpTokens,
  revokeAdminOAuthFamily,
  revokeAdminPersonalToken,
} from "./mcp-admin";

type Call = { sql: string; params?: unknown[] };

const WORKSPACE_ID = 7;
const ACTOR_ID = 1;
const FAMILY_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = 42;

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

function listQueryable(
  options: { pats?: Record<string, unknown>[]; oauth?: Record<string, unknown>[] },
  calls: Call[],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("WITH family_rows AS")) return result(options.oauth ?? []);
      if (sql.includes("FROM mcp_tokens t") && sql.includes("AND t.kind = 'pat'")) {
        return result(options.pats ?? []);
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
  });
}

test("the admin token list merges PATs and OAuth families newest-used first", async () => {
  const calls: Call[] = [];
  const q = listQueryable({
    pats: [
      {
        id: 9,
        user_id: 42,
        user_name: "山田 太郎",
        user_email: "taro@example.com",
        name: "Laptop",
        scopes: ["read"],
        created_at: "2026-11-19T00:00:00Z",
        last_used_at: "2026-11-20T00:00:00Z",
      },
      {
        id: 10,
        user_id: 43,
        user_name: "佐藤 花子",
        user_email: "hanako@example.com",
        name: "Phone",
        scopes: ["read", "write"],
        created_at: "2026-11-18T00:00:00Z",
        last_used_at: null,
      },
    ],
    oauth: [{
      family_id: FAMILY_ID,
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      user_id: 42,
      user_name: "山田 太郎",
      user_email: "taro@example.com",
      client_name: "Claude Code",
      resource: "https://atlas.test/mcp",
      scopes: ["read", "write"],
      first_authorized_at: "2026-11-17T00:00:00Z",
      last_used_at: "2026-11-24T00:00:00Z",
    }],
  }, calls);

  const tokens = await listAdminMcpTokens(WORKSPACE_ID, q);
  assert.deepEqual(tokens.map((token) => (
    token.kind === "pat" ? `pat:${token.id}` : `oauth:${token.family_id}`
  )), [`oauth:${FAMILY_ID}`, "pat:9", "pat:10"]);

  const oauth = tokens[0];
  assert.equal(oauth.kind, "oauth");
  if (oauth.kind === "oauth") {
    assert.equal(oauth.client_name, "Claude Code");
    assert.equal(oauth.endpoint, "default");
    assert.equal(oauth.read_only, false);
    assert.deepEqual(oauth.scopes, ["read", "write"]);
    assert.equal(oauth.first_authorized_at, "2026-11-17T00:00:00Z");
  }

  const pat = tokens[1];
  assert.equal(pat.kind, "pat");
  if (pat.kind === "pat") {
    assert.equal(pat.name, "Laptop");
    assert.equal(pat.read_only, true);
    assert.equal(pat.created_at, "2026-11-19T00:00:00Z");
  }

  assert.deepEqual(calls[0].params, [WORKSPACE_ID]);
  assert.match(calls[0].sql, /t\.kind = 'pat'/);
  assert.match(calls[0].sql, /t\.revoked_at IS NULL/);
  assert.match(calls[0].sql, /t\.expires_at IS NULL OR t\.expires_at > now\(\)/);
  assert.deepEqual(calls[1].params, [WORKSPACE_ID]);
  assert.match(calls[1].sql, /valid_family/);
  assert.match(calls[1].sql, /expires_at > now\(\)/);
  assert.match(calls[1].sql, /oauth_family_id/);
});

test("OAuth rows fall back to the client host and honor the readonly endpoint", async () => {
  const calls: Call[] = [];
  const q = listQueryable({
    oauth: [{
      family_id: FAMILY_ID,
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      user_id: 42,
      user_name: null,
      user_email: "taro@example.com",
      client_name: "   ",
      resource: "https://atlas.test/mcp/readonly",
      scopes: ["read", "write"],
      first_authorized_at: "2026-11-17T00:00:00Z",
      last_used_at: null,
    }],
  }, calls);

  const tokens = await listAdminMcpTokens(WORKSPACE_ID, q);
  assert.equal(tokens.length, 1);
  const oauth = tokens[0];
  assert.equal(oauth.kind, "oauth");
  if (oauth.kind === "oauth") {
    assert.equal(oauth.client_name, "claude.ai");
    assert.equal(oauth.endpoint, "readonly");
    assert.equal(oauth.read_only, true);
    assert.equal(oauth.last_used_at, null);
  }
});

test("a nameless DCR client is labeled like the personal OAuth list", async () => {
  const calls: Call[] = [];
  const q = listQueryable({
    oauth: [{
      family_id: FAMILY_ID,
      client_id: "atlas_oauth_opaque",
      user_id: 42,
      user_name: "山田 太郎",
      user_email: "taro@example.com",
      client_name: null,
      resource: "https://atlas.test/mcp",
      scopes: ["read"],
      first_authorized_at: "2026-11-17T00:00:00Z",
      last_used_at: null,
    }],
  }, calls);

  const [oauth] = await listAdminMcpTokens(WORKSPACE_ID, q);
  assert.equal(oauth.kind, "oauth");
  if (oauth.kind === "oauth") assert.equal(oauth.client_name, "動的に登録されたアプリ");
});

function revokePatQueryable(
  options: { updated?: boolean; existing?: boolean },
  calls: Call[],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("UPDATE mcp_tokens t SET revoked_at")) {
        return options.updated === false
          ? result([], 0)
          : result([{
              id: Number(params?.[0]),
              name: "Laptop",
              user_id: TARGET_USER_ID,
              user_name: "山田 太郎",
              user_email: "taro@example.com",
            }], 1);
      }
      if (sql.includes("SELECT t.id") && sql.includes("FROM mcp_tokens t")) {
        return result(options.existing === true ? [{ id: Number(params?.[0]) }] : [], options.existing === true ? 1 : 0);
      }
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("admin PAT revocation is workspace-scoped and audits the target user", async () => {
  const calls: Call[] = [];
  const revoked = await revokeAdminPersonalToken(
    ACTOR_ID,
    WORKSPACE_ID,
    9,
    revokePatQueryable({}, calls),
  );
  assert.deepEqual(revoked, { id: 9 });

  const update = calls.find((call) => call.sql.includes("UPDATE mcp_tokens t SET revoked_at"));
  assert.ok(update);
  assert.deepEqual(update.params, [9, WORKSPACE_ID]);
  assert.match(update.sql, /t\.kind = 'pat'/);
  assert.match(update.sql, /t\.revoked_at IS NULL/);
  assert.match(update.sql, /t\.workspace_id = \$2/);

  const audit = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit);
  assert.equal(audit.params?.[0], WORKSPACE_ID);
  assert.equal(audit.params?.[1], ACTOR_ID);
  assert.equal(audit.params?.[2], "mcp.token.admin_revoke");
  assert.equal(audit.params?.[4], 9);
  assert.match(String(audit.params?.[6]), /Laptop/);
  assert.match(String(audit.params?.[6]), /山田 太郎/);
});

test("a missing, OAuth, or other-workspace PAT is reported as not found", async () => {
  const calls: Call[] = [];
  await assertApiError(
    revokeAdminPersonalToken(ACTOR_ID, WORKSPACE_ID, 9, revokePatQueryable({ updated: false }, calls)),
    404,
    "token not found",
  );
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO audit_log")));
  assert.deepEqual(calls[1].params, [9, WORKSPACE_ID]);
  assert.match(calls[1].sql, /t\.kind = 'pat'/);
});

test("revoking an already revoked PAT stays idempotent without a second audit row", async () => {
  const calls: Call[] = [];
  const revoked = await revokeAdminPersonalToken(
    ACTOR_ID,
    WORKSPACE_ID,
    9,
    revokePatQueryable({ updated: false, existing: true }, calls),
  );
  assert.deepEqual(revoked, { id: 9 });
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO audit_log")));
});

test("a malformed PAT id is not queried", async () => {
  const calls: Call[] = [];
  await assertApiError(
    revokeAdminPersonalToken(ACTOR_ID, WORKSPACE_ID, Number.NaN, revokePatQueryable({}, calls)),
    404,
    "token not found",
  );
  assert.equal(calls.length, 0);
});

function revokeFamilyQueryable(
  options: {
    owner?: boolean;
    userExists?: boolean;
    accessUpdates?: number;
    refreshUpdates?: number;
  },
  calls: Call[],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT owner.user_id")) {
        return options.owner === false
          ? result([])
          : result([{
              user_id: TARGET_USER_ID,
              client_name: "Claude Code",
              user_name: "山田 太郎",
              user_email: "taro@example.com",
            }], 1);
      }
      if (sql.includes("SELECT id FROM users WHERE id = $1::bigint FOR UPDATE")) {
        return options.userExists === false
          ? result([], 0)
          : result([{ id: TARGET_USER_ID }], 1);
      }
      if (sql.includes("pg_advisory_xact_lock")) return result([{ pg_advisory_xact_lock: null }]);
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) {
        return result([], options.accessUpdates ?? 2);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) {
        return result([], options.refreshUpdates ?? 1);
      }
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("admin OAuth revocation locks the target user before the family and token rows", async () => {
  const calls: Call[] = [];
  const revoked = await revokeAdminOAuthFamily(
    ACTOR_ID,
    WORKSPACE_ID,
    FAMILY_ID,
    revokeFamilyQueryable({}, calls),
  );
  assert.deepEqual(revoked, { family_id: FAMILY_ID });

  const userLock = calls.findIndex(
    (call) => call.sql.includes("SELECT id FROM users WHERE id = $1::bigint FOR UPDATE"),
  );
  const familyLock = calls.findIndex((call) => call.sql.includes("pg_advisory_xact_lock"));
  const access = calls.findIndex((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at"));
  const refresh = calls.findIndex((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at"));
  assert.ok(userLock >= 0, "the target user row must be locked");
  assert.ok(familyLock >= 0, "the family advisory lock must be taken");
  assert.ok(userLock < familyLock, "the user row lock must precede the family lock");
  assert.ok(access > familyLock, "access tokens must be updated after the family lock");
  assert.ok(refresh > familyLock, "refresh tokens must be updated after the family lock");
  assert.deepEqual(calls[userLock].params, [TARGET_USER_ID]);
  assert.deepEqual(calls[familyLock].params, [FAMILY_ID]);
  assert.deepEqual(calls[access].params, [FAMILY_ID, WORKSPACE_ID, TARGET_USER_ID]);
  assert.deepEqual(calls[refresh].params, [FAMILY_ID, WORKSPACE_ID, TARGET_USER_ID]);
  assert.match(calls[access].sql, /oauth_family_id = \$1::uuid/);
  assert.match(calls[refresh].sql, /family_id = \$1::uuid/);

  const audit = calls.find((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit);
  assert.equal(audit.params?.[0], WORKSPACE_ID);
  assert.equal(audit.params?.[1], ACTOR_ID);
  assert.equal(audit.params?.[2], "mcp.oauth.admin_revoke");
  assert.match(String(audit.params?.[6]), /Claude Code/);
  assert.match(String(audit.params?.[6]), /山田 太郎/);
});

test("a missing family is reported as not found and is never locked or revoked", async () => {
  const calls: Call[] = [];
  await assertApiError(
    revokeAdminOAuthFamily(
      ACTOR_ID,
      WORKSPACE_ID,
      FAMILY_ID,
      revokeFamilyQueryable({ owner: false }, calls),
    ),
    404,
    "connection not found",
  );
  assert.ok(!calls.some((call) => call.sql.includes("FOR UPDATE")));
  assert.ok(!calls.some((call) => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
});

test("a missing target user is reported as not found before the family lock", async () => {
  const calls: Call[] = [];
  await assertApiError(
    revokeAdminOAuthFamily(
      ACTOR_ID,
      WORKSPACE_ID,
      FAMILY_ID,
      revokeFamilyQueryable({ userExists: false }, calls),
    ),
    404,
    "connection not found",
  );
  assert.ok(!calls.some((call) => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
});

test("an already revoked OAuth family stays idempotent without another audit row", async () => {
  const calls: Call[] = [];
  const revoked = await revokeAdminOAuthFamily(
    ACTOR_ID,
    WORKSPACE_ID,
    FAMILY_ID,
    revokeFamilyQueryable({ accessUpdates: 0, refreshUpdates: 0 }, calls),
  );
  assert.deepEqual(revoked, { family_id: FAMILY_ID });
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO audit_log")));
});

test("a malformed family id is not queried", async () => {
  const calls: Call[] = [];
  await assertApiError(
    revokeAdminOAuthFamily(ACTOR_ID, WORKSPACE_ID, "../../etc/passwd", revokeFamilyQueryable({}, calls)),
    404,
    "connection not found",
  );
  assert.equal(calls.length, 0);
});

function logQueryable(rows: Record<string, unknown>[], calls: Call[]): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM mcp_request_log l")) return result(rows);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function logRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 - index,
    token_id: 5,
    token_name: "Laptop",
    user_id: 42,
    user_name: "山田 太郎",
    user_email: "taro@example.com",
    endpoint: "default",
    rpc_method: "tools/call",
    tool_name: "list_projects",
    outcome: "ok",
    error_code: null,
    duration_ms: 12,
    client_name: "Claude Code",
    client_ip: "127.0.0.1",
    created_at: "2026-11-24T00:00:00Z",
  }));
}

test("the request log page applies the outcome filter and cursor", async () => {
  const calls: Call[] = [];
  const page = await listAdminMcpRequestLogs(
    WORKSPACE_ID,
    { outcome: "denied", cursor: 99 },
    logQueryable(logRows(2), calls),
  );
  assert.equal(page.logs.length, 2);
  assert.deepEqual(calls[0].params, [WORKSPACE_ID, "denied", 99]);
  assert.match(calls[0].sql, /l\.outcome = \$2/);
  assert.match(calls[0].sql, /l\.id < \$3/);
  assert.match(calls[0].sql, /LIMIT 51/);
  assert.match(calls[0].sql, /CASE WHEN t\.kind = 'oauth' THEN t\.client_name/);
});

test("the request log page returns a cursor only when another page exists", async () => {
  const calls: Call[] = [];
  const page = await listAdminMcpRequestLogs(
    WORKSPACE_ID,
    { outcome: "all", cursor: null },
    logQueryable(logRows(51), calls),
  );
  assert.equal(page.logs.length, 50);
  assert.equal(page.nextCursor, 51);
  assert.deepEqual(calls[0].params, [WORKSPACE_ID]);
  assert.ok(!calls[0].sql.includes("l.outcome ="));
  assert.ok(!calls[0].sql.includes("l.id <"));

  const exactCalls: Call[] = [];
  const exact = await listAdminMcpRequestLogs(
    WORKSPACE_ID,
    { outcome: "all", cursor: null },
    logQueryable(logRows(50), exactCalls),
  );
  assert.equal(exact.logs.length, 50);
  assert.equal(exact.nextCursor, null);
});

test("only the documented outcome filters are accepted", () => {
  for (const value of ["all", "ok", "error", "denied", "unauthenticated"]) {
    assert.equal(isMcpLogOutcomeFilter(value), true);
  }
  for (const value of ["", "success", "failure", "OK"]) {
    assert.equal(isMcpLogOutcomeFilter(value), false);
  }
});
