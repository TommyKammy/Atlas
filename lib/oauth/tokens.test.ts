import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "@/lib/db";
import { hashMcpToken, isMcpToken } from "@/lib/mcp/token";
import { OAuthError } from "./errors";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  isOAuthAccessToken,
  isOAuthRefreshToken,
  issueTokens,
  refreshTokens,
  revokeToken,
} from "./tokens";

process.env.APP_URL = "https://atlas.test";

const CLIENT_ID = "https://client.example/oauth/client.json";
const RESOURCE = "https://atlas.test/mcp";
const READONLY_RESOURCE = "https://atlas.test/mcp/readonly";

type Call = { sql: string; params?: unknown[] };

type AccessRow = {
  id: number;
  token_hash: string;
  kind: string;
  user_id: number;
  workspace_id: number;
  client_name: string | null;
  resource: string | null;
  oauth_family_id: string | null;
  revoked_at: Date | null;
};

type RefreshRow = {
  id: number;
  token_hash: string;
  family_id: string;
  client_id: string;
  user_id: number;
  workspace_id: number;
  scopes: string[];
  resource: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
};

type PrincipalOptions = {
  exists?: boolean;
  deactivated?: boolean;
  guest?: boolean;
  mcpEnabled?: boolean;
};

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

function createDb(options: { principal?: PrincipalOptions } = {}) {
  const calls: Call[] = [];
  const access: AccessRow[] = [];
  const refresh: RefreshRow[] = [];
  let nextId = 100;
  const principal = {
    exists: options.principal?.exists !== false,
    deactivated: options.principal?.deactivated === true,
    guest: options.principal?.guest === true,
    mcpEnabled: options.principal?.mcpEnabled !== false,
  };

  const q: Queryable = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM users u")) {
        if (!principal.exists) return result();
        return result([{
          id: params[0],
          deactivated_at: principal.deactivated ? "2026-01-01T00:00:00Z" : null,
          is_guest: principal.guest,
          mcp_enabled: principal.mcpEnabled,
        }]);
      }
      if (sql.includes("INSERT INTO mcp_tokens")) {
        const id = nextId++;
        access.push({
          id,
          token_hash: String(params[3]),
          kind: "oauth",
          user_id: Number(params[1]),
          workspace_id: Number(params[0]),
          client_name: typeof params[5] === "string" ? params[5] : null,
          resource: typeof params[6] === "string" ? params[6] : null,
          oauth_family_id: params[8] === undefined || params[8] === null ? null : String(params[8]),
          revoked_at: null,
        });
        return result([{ id, expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }]);
      }
      if (sql.includes("INSERT INTO oauth_refresh_tokens")) {
        const id = nextId++;
        refresh.push({
          id,
          token_hash: String(params[0]),
          family_id: String(params[1]),
          client_id: String(params[2]),
          user_id: Number(params[3]),
          workspace_id: Number(params[4]),
          scopes: params[5] as string[],
          resource: String(params[6]),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          used_at: null,
          revoked_at: null,
        });
        return result([{ id, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString() }]);
      }
      if (sql.includes("SELECT id, user_id, workspace_id") && sql.includes("FROM oauth_refresh_tokens")) {
        const row = refresh.find((entry) => entry.token_hash === params[0]);
        return result(row ? [{ id: row.id, user_id: row.user_id, workspace_id: row.workspace_id }] : []);
      }
      if (sql.includes("FROM oauth_refresh_tokens rt")) {
        const row = refresh.find((entry) => entry.id === Number(params[0]));
        return result(row ? [{ ...row, client_name: "Test Client" }] : []);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET used_at")) {
        const row = refresh.find((entry) => entry.id === Number(params[0]));
        if (!row || row.used_at !== null) return result([], 0);
        row.used_at = new Date();
        return result([], 1);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) {
        let count = 0;
        for (const row of refresh) {
          if (row.family_id === params[0] && row.revoked_at === null) {
            row.revoked_at = new Date();
            count += 1;
          }
        }
        return result([], count);
      }
      if (sql.includes("UPDATE mcp_tokens SET revoked_at") && sql.includes("oauth_family_id")) {
        let count = 0;
        for (const row of access) {
          if (row.oauth_family_id === params[0] && row.revoked_at === null) {
            row.revoked_at = new Date();
            count += 1;
          }
        }
        return result([], count);
      }
      if (sql.includes("SELECT id, oauth_family_id::text AS oauth_family_id") && sql.includes("FROM mcp_tokens")) {
        const row = access.find((entry) => entry.token_hash === params[0]);
        return result(row ? [{ id: row.id, oauth_family_id: row.oauth_family_id }] : []);
      }
      if (sql.includes("SELECT family_id::text AS family_id") && sql.includes("FROM oauth_refresh_tokens")) {
        const row = refresh.find((entry) => entry.token_hash === params[0]);
        return result(row ? [{ family_id: row.family_id }] : []);
      }
      if (sql.includes("UPDATE mcp_tokens SET revoked_at") && sql.includes("WHERE id = $1")) {
        const row = access.find((entry) => entry.id === Number(params[0]));
        if (!row || row.revoked_at !== null) return result([], 0);
        row.revoked_at = new Date();
        return result([], 1);
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  return { q, calls, access, refresh, principal };
}

async function assertOAuthError(promise: Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OAuthError, `expected OAuthError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

async function issue(db: ReturnType<typeof createDb>, overrides: Record<string, unknown> = {}) {
  return issueTokens({
    userId: 42,
    workspaceId: 1,
    clientId: CLIENT_ID,
    clientName: "Test Client",
    scopes: ["read", "write"],
    resource: RESOURCE,
    ...overrides,
  }, db.q);
}

test("issuing tokens returns distinct OAuth plaintexts and stores only hashes", async () => {
  const db = createDb();
  const issued = await issue(db);

  assert.equal(issued.tokenType, "Bearer");
  assert.equal(issued.expiresIn, ACCESS_TOKEN_TTL_SECONDS);
  assert.equal(issued.refreshExpiresIn, REFRESH_TOKEN_TTL_SECONDS);
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 86_400);
  assert.equal(REFRESH_TOKEN_TTL_SECONDS, 2_592_000);
  assert.equal(isOAuthAccessToken(issued.accessToken), true);
  assert.equal(isOAuthRefreshToken(issued.refreshToken), true);
  assert.equal(isMcpToken(issued.accessToken), false);
  assert.equal(issued.accessToken.startsWith("atlas_oat_"), true);
  assert.equal(issued.refreshToken.startsWith("atlas_ort_"), true);
  assert.deepEqual(issued.scopes, ["read", "write"]);
  assert.equal(issued.resource, RESOURCE);
  assert.match(issued.familyId, /^[0-9a-f-]{36}$/);

  assert.equal(db.access.length, 1);
  assert.equal(db.refresh.length, 1);
  assert.equal(db.access[0].token_hash, hashMcpToken(issued.accessToken));
  assert.notEqual(db.access[0].token_hash, issued.accessToken);
  assert.equal(db.access[0].kind, "oauth");
  assert.equal(db.access[0].resource, RESOURCE);
  assert.equal(db.access[0].oauth_family_id, issued.familyId);
  assert.equal(db.access[0].client_name, "Test Client");
  assert.equal(db.refresh[0].token_hash, hashMcpToken(issued.refreshToken));
  assert.notEqual(db.refresh[0].token_hash, issued.refreshToken);
  assert.equal(db.refresh[0].family_id, issued.familyId);
  assert.deepEqual(db.refresh[0].scopes, ["read", "write"]);

  const accessInsert = db.calls.find((call) => call.sql.includes("INSERT INTO mcp_tokens"));
  assert.match(accessInsert?.sql ?? "", /interval '24 hours'/);
  const refreshInsert = db.calls.find((call) => call.sql.includes("INSERT INTO oauth_refresh_tokens"));
  assert.match(refreshInsert?.sql ?? "", /interval '30 days'/);
});

test("a readonly grant keeps the readonly resource and read-only scopes", async () => {
  const db = createDb();
  const issued = await issue(db, { scopes: ["read"], resource: READONLY_RESOURCE });
  assert.equal(issued.resource, READONLY_RESOURCE);
  assert.deepEqual(issued.scopes, ["read"]);
});

test("issuance rejects guests, deactivated users, unknown users and disabled MCP", async () => {
  const cases: Array<[PrincipalOptions, string, RegExp]> = [
    [{ guest: true }, "access_denied", /guest/],
    [{ deactivated: true }, "access_denied", /inactive/],
    [{ exists: false }, "access_denied", /inactive/],
    [{ mcpEnabled: false }, "access_denied", /disabled/],
  ];
  for (const [principal, code, message] of cases) {
    const db = createDb({ principal });
    await assertOAuthError(issue(db), code, message);
    assert.equal(db.access.length, 0);
    assert.equal(db.refresh.length, 0);
  }
});

test("issuance validates scopes and the resource audience", async () => {
  const db = createDb();
  await assertOAuthError(issue(db, { scopes: ["write"] }), "invalid_scope");
  await assertOAuthError(issue(db, { scopes: ["read", "admin"] }), "invalid_scope");
  await assertOAuthError(issue(db, { resource: "https://atlas.test/other" }), "invalid_target");
  assert.equal(db.access.length, 0);
});

test("OAuth issuance ignores mcp_pat_enabled (OAuth needs only mcp_enabled)", async () => {
  const db = createDb();
  const issued = await issue(db);
  assert.equal(issued.accessToken.startsWith("atlas_oat_"), true);
  assert.ok(!db.calls.some((call) => call.sql.includes("mcp_pat_enabled")));
});

test("refreshing rotates the refresh token inside the same family", async () => {
  const db = createDb();
  const first = await issue(db);
  const second = await refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q);

  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.notEqual(second.accessToken, first.accessToken);
  assert.equal(second.familyId, first.familyId);
  assert.deepEqual(second.scopes, ["read", "write"]);
  assert.equal(second.resource, RESOURCE);
  assert.ok(db.refresh[0].used_at instanceof Date);
  assert.equal(db.refresh.length, 2);
  assert.equal(db.refresh[1].family_id, first.familyId);
  assert.equal(db.access.length, 2);
  assert.equal(db.access[1].oauth_family_id, first.familyId);
  assert.equal(db.access[1].token_hash, hashMcpToken(second.accessToken));
  assert.equal(db.refresh[1].token_hash, hashMcpToken(second.refreshToken));
});

test("reusing a used refresh token revokes every token in the family", async () => {
  const db = createDb();
  const first = await issue(db);
  await refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q);

  await assertOAuthError(
    refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q),
    "invalid_grant",
    /reuse/,
  );
  assert.equal(db.refresh.length, 2);
  assert.ok(db.refresh.every((row) => row.revoked_at instanceof Date));
  assert.equal(db.access.length, 2);
  assert.ok(db.access.every((row) => row.revoked_at instanceof Date));
});

test("a refresh token cannot be used by another client", async () => {
  const db = createDb();
  const first = await issue(db);
  await assertOAuthError(
    refreshTokens(first.refreshToken, "https://other.example/client.json", RESOURCE, db.q),
    "invalid_grant",
    /another client/,
  );
  assert.equal(db.refresh[0].used_at, null);
  assert.equal(db.refresh.length, 1);
});

test("refresh rejects a different resource audience", async () => {
  const db = createDb();
  const first = await issue(db);
  await assertOAuthError(
    refreshTokens(first.refreshToken, CLIENT_ID, READONLY_RESOURCE, db.q),
    "invalid_target",
  );
  assert.equal(db.refresh[0].used_at, null);
});

test("refresh fails closed for guests, deactivated users and disabled MCP", async () => {
  for (const principal of [{ guest: true }, { deactivated: true }, { mcpEnabled: false }]) {
    const db = createDb();
    const first = await issue(db);
    db.principal.guest = principal.guest === true;
    db.principal.deactivated = principal.deactivated === true;
    db.principal.mcpEnabled = principal.mcpEnabled !== false;
    await assertOAuthError(
      refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q),
      "access_denied",
    );
    assert.equal(db.refresh[0].used_at, null);
    assert.equal(db.refresh.length, 1);
  }
});

test("expired and revoked refresh tokens are rejected", async () => {
  const expired = createDb();
  const expiredGrant = await issue(expired);
  expired.refresh[0].expires_at = new Date(Date.now() - 1_000);
  await assertOAuthError(
    refreshTokens(expiredGrant.refreshToken, CLIENT_ID, RESOURCE, expired.q),
    "invalid_grant",
    /expired/,
  );

  const revoked = createDb();
  const revokedGrant = await issue(revoked);
  revoked.refresh[0].revoked_at = new Date();
  await assertOAuthError(
    refreshTokens(revokedGrant.refreshToken, CLIENT_ID, RESOURCE, revoked.q),
    "invalid_grant",
    /revoked/,
  );
});

test("malformed and unknown refresh tokens are rejected", async () => {
  const db = createDb();
  await assertOAuthError(refreshTokens("atlas_ort_short", CLIENT_ID, undefined, db.q), "invalid_grant");
  await assertOAuthError(
    refreshTokens(`atlas_ort_${"a".repeat(43)}`, CLIENT_ID, undefined, db.q),
    "invalid_grant",
  );
});

test("revoking an access token revokes the whole family", async () => {
  const db = createDb();
  const first = await issue(db);
  const second = await refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q);
  assert.equal(await revokeToken(second.accessToken, db.q), true);
  assert.ok(db.refresh.every((row) => row.revoked_at instanceof Date));
  assert.ok(db.access.every((row) => row.revoked_at instanceof Date));
});

test("revoking a refresh token revokes the whole family", async () => {
  const db = createDb();
  const first = await issue(db);
  const second = await refreshTokens(first.refreshToken, CLIENT_ID, RESOURCE, db.q);
  assert.equal(await revokeToken(second.refreshToken, db.q), true);
  assert.ok(db.refresh.every((row) => row.revoked_at instanceof Date));
  assert.ok(db.access.every((row) => row.revoked_at instanceof Date));
});

test("revokeToken accepts refresh plaintext and ignores unknown values", async () => {
  const db = createDb();
  const first = await issue(db);
  assert.equal(await revokeToken(first.refreshToken, db.q), true);
  assert.ok(db.refresh[0].revoked_at instanceof Date);
  assert.ok(db.access[0].revoked_at instanceof Date);

  assert.equal(await revokeToken(`atlas_ort_${"z".repeat(43)}`, db.q), false);
  assert.equal(await revokeToken("not-a-token", db.q), false);
  assert.equal(await revokeToken(`atlas_oat_${"z".repeat(43)}`, db.q), false);
});
