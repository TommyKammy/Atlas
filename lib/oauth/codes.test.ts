import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "@/lib/db";
import { hashMcpToken } from "@/lib/mcp/token";
import {
  consumeAuthorizationCode,
  isAuthorizationCode,
  issueAuthorizationCode,
} from "./codes";
import { OAuthError } from "./errors";
import { s256Challenge } from "./pkce";

process.env.APP_URL = "https://atlas.test";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

function mockQueryable(
  options: {
    row?: Record<string, unknown>;
    lockedRow?: Record<string, unknown> | null;
    updatedCount?: number;
    userExists?: boolean;
  } = {},
  calls: Call[] = [],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO oauth_authorization_codes")) {
        return result([{ expires_at: "2026-11-24T00:10:00Z" }]);
      }
      if (sql.includes("SELECT user_id, family_id::text AS family_id")
          && sql.includes("FROM oauth_authorization_codes")) {
        return result(options.row
          ? [{ user_id: options.row.user_id, family_id: options.row.family_id }]
          : []);
      }
      if (sql.includes("SELECT id FROM users")) {
        return result(options.userExists === false ? [] : [{ id: Number(params?.[0]) }]);
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        return result([{ pg_advisory_xact_lock: null }]);
      }
      if (sql.includes("FROM oauth_authorization_codes")) {
        const row = options.lockedRow === undefined ? options.row : options.lockedRow;
        return result(row ? [row] : []);
      }
      if (sql.includes("UPDATE oauth_authorization_codes SET used_at")) {
        return result([], options.updatedCount ?? 1);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) return result([], 1);
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) return result([], 1);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const CODE = `atlas_oac_${"a".repeat(43)}`;
const VERIFIER = "v".repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);
const FAMILY_ID = randomUUID();
const CLIENT_ID = "https://client.example/oauth/client.json";
const REDIRECT_URI = "http://127.0.0.1:5555/callback";
const RESOURCE = "https://atlas.test/mcp";

function codeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 11,
    code_hash: hashMcpToken(CODE),
    client_id: CLIENT_ID,
    user_id: 42,
    workspace_id: 1,
    redirect_uri: REDIRECT_URI,
    code_challenge: CHALLENGE,
    scopes: ["read", "write"],
    resource: RESOURCE,
    family_id: FAMILY_ID,
    expires_at: new Date(Date.now() + 5 * 60_000),
    used_at: null,
    ...overrides,
  };
}

function consumeInput(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    resource: RESOURCE,
    codeVerifier: VERIFIER,
    ...overrides,
  };
}

async function assertOAuthError(promise: Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OAuthError);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("issuing a code returns the plaintext once and stores only the hash", async () => {
  const calls: Call[] = [];
  const issued = await issueAuthorizationCode({
    clientId: CLIENT_ID,
    userId: 42,
    workspaceId: 1,
    redirectUri: REDIRECT_URI,
    codeChallenge: CHALLENGE,
    scopes: ["read", "write"],
    resource: RESOURCE,
  }, mockQueryable({}, calls));

  assert.equal(isAuthorizationCode(issued.code), true);
  assert.match(issued.familyId, /^[0-9a-f-]{36}$/);
  assert.equal(issued.expiresAt, "2026-11-24T00:10:00Z");
  const insert = calls.find((call) => call.sql.includes("INSERT INTO oauth_authorization_codes"));
  assert.ok(insert);
  assert.equal(insert.params?.[0], hashMcpToken(issued.code));
  assert.notEqual(insert.params?.[0], issued.code);
  assert.equal(insert.params?.[5], CHALLENGE);
  assert.deepEqual(insert.params?.[6], ["read", "write"]);
  assert.equal(insert.params?.[7], RESOURCE);
  assert.equal(insert.params?.[8], issued.familyId);
  assert.match(insert.sql, /interval '10 minutes'/);
});

test("code issuance rejects plain/invalid challenges, scopes and resources", async () => {
  const base = {
    clientId: CLIENT_ID,
    userId: 42,
    workspaceId: 1,
    redirectUri: REDIRECT_URI,
    codeChallenge: CHALLENGE,
    scopes: ["read"],
    resource: RESOURCE,
  };
  await assertOAuthError(
    issueAuthorizationCode({ ...base, codeChallenge: "plain" }, mockQueryable()),
    "invalid_request",
  );
  await assertOAuthError(
    issueAuthorizationCode({ ...base, codeChallengeMethod: "plain" }, mockQueryable()),
    "invalid_request",
  );
  await assertOAuthError(
    issueAuthorizationCode({ ...base, scopes: ["write"] }, mockQueryable()),
    "invalid_scope",
  );
  await assertOAuthError(
    issueAuthorizationCode({ ...base, scopes: ["read", "admin"] }, mockQueryable()),
    "invalid_scope",
  );
  await assertOAuthError(
    issueAuthorizationCode({ ...base, resource: "https://atlas.test/other" }, mockQueryable()),
    "invalid_target",
  );
  await assertOAuthError(
    issueAuthorizationCode({ ...base, redirectUri: "http://example.test/callback" }, mockQueryable()),
    "invalid_request",
  );
});

test("consuming a valid code marks it used and returns its grant", async () => {
  const calls: Call[] = [];
  const consumed = await consumeAuthorizationCode(
    consumeInput(),
    mockQueryable({ row: codeRow() }, calls),
  );
  assert.deepEqual(consumed, {
    clientId: CLIENT_ID,
    userId: 42,
    workspaceId: 1,
    redirectUri: REDIRECT_URI,
    scopes: ["read", "write"],
    resource: RESOURCE,
    familyId: FAMILY_ID,
  });
  const update = calls.find((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at"));
  assert.ok(update);
  assert.deepEqual(update.params, [11]);
});

test("consume locks the user, the family and then the code row", async () => {
  const calls: Call[] = [];
  await consumeAuthorizationCode(consumeInput(), mockQueryable({ row: codeRow() }, calls));

  const ownerRead = calls.findIndex((call) => call.sql.includes("SELECT user_id, family_id::text AS family_id"));
  const userLock = calls.findIndex((call) => call.sql.includes("SELECT id FROM users") && call.sql.includes("FOR UPDATE"));
  const familyLock = calls.findIndex((call) => call.sql.includes("pg_advisory_xact_lock"));
  const codeLock = calls.findIndex((call) => call.sql.includes("FROM oauth_authorization_codes") && call.sql.includes("FOR UPDATE"));
  const used = calls.findIndex((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at"));

  assert.ok(ownerRead >= 0, "the code owner must be read without a lock first");
  assert.ok(userLock > ownerRead, "the user row must be locked after reading the owner");
  assert.ok(familyLock > userLock, "the family lock must follow the user row lock");
  assert.ok(codeLock > familyLock, "the code row must be locked after the family lock");
  assert.ok(used > codeLock, "the code must be locked before it is marked used");
  assert.deepEqual(calls[userLock].params, [42]);
  assert.deepEqual(calls[familyLock].params, [FAMILY_ID]);
});

test("a code row that disappears before the locked read is invalid_grant", async () => {
  const calls: Call[] = [];
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput(),
      mockQueryable({ row: codeRow(), lockedRow: null }, calls),
    ),
    "invalid_grant",
  );
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
});

test("a missing user row is invalid_grant", async () => {
  const calls: Call[] = [];
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput(),
      mockQueryable({ row: codeRow(), userExists: false }, calls),
    ),
    "invalid_grant",
  );
  assert.ok(!calls.some((call) => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at")));
});

test("omitting resource at the token endpoint uses the code's stored audience", async () => {
  const consumed = await consumeAuthorizationCode(
    consumeInput({ resource: undefined }),
    mockQueryable({ row: codeRow() }),
  );
  assert.equal(consumed.resource, RESOURCE);
});

test("an expired code is rejected without being marked used", async () => {
  const calls: Call[] = [];
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput(),
      mockQueryable({ row: codeRow({ expires_at: new Date(Date.now() - 1_000) }) }, calls),
    ),
    "invalid_grant",
    /expired/,
  );
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at")));
});

test("a second use is rejected and revokes the whole token family", async () => {
  const calls: Call[] = [];
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput(),
      mockQueryable({ row: codeRow({ used_at: new Date() }) }, calls),
    ),
    "invalid_grant",
    /already been used/,
  );
  const refreshRevoke = calls.find((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at"));
  const accessRevoke = calls.find((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at"));
  assert.ok(refreshRevoke);
  assert.ok(accessRevoke);
  assert.deepEqual(refreshRevoke.params, [FAMILY_ID]);
  assert.deepEqual(accessRevoke.params, [FAMILY_ID]);
  const familyLock = calls.findIndex((call) => call.sql.includes("pg_advisory_xact_lock"));
  assert.ok(familyLock >= 0, "replay revocation must take the family advisory lock");
  assert.ok(familyLock < calls.indexOf(accessRevoke));
  assert.ok(familyLock < calls.indexOf(refreshRevoke));
});

test("a lost race on used_at is treated as reuse and revokes the family", async () => {
  const calls: Call[] = [];
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput(),
      mockQueryable({ row: codeRow(), updatedCount: 0 }, calls),
    ),
    "invalid_grant",
    /already been used/,
  );
  assert.ok(calls.some((call) => call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")));
  assert.ok(calls.some((call) => call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
});

test("client, redirect_uri and resource mismatches are rejected", async () => {
  const cases: Array<Record<string, unknown>> = [
    { clientId: "other-client" },
    { redirectUri: "http://127.0.0.1:5555/other" },
    { resource: "https://atlas.test/mcp/readonly" },
  ];
  for (const overrides of cases) {
    const calls: Call[] = [];
    await assertOAuthError(
      consumeAuthorizationCode(consumeInput(overrides), mockQueryable({ row: codeRow() }, calls)),
      "invalid_grant",
    );
    assert.ok(!calls.some((call) => call.sql.includes("UPDATE oauth_authorization_codes SET used_at")));
  }
});

test("PKCE mismatch, plain and malformed verifiers are rejected", async () => {
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput({ codeVerifier: "w".repeat(43) }),
      mockQueryable({ row: codeRow() }),
    ),
    "invalid_grant",
    /PKCE/,
  );
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput({ codeChallengeMethod: "plain" }),
      mockQueryable({ row: codeRow() }),
    ),
    "invalid_grant",
    /PKCE/,
  );
  await assertOAuthError(
    consumeAuthorizationCode(
      consumeInput({ codeVerifier: "short" }),
      mockQueryable({ row: codeRow() }),
    ),
    "invalid_grant",
    /PKCE/,
  );
});

test("unknown and malformed codes are rejected", async () => {
  await assertOAuthError(
    consumeAuthorizationCode(consumeInput({ code: `atlas_oac_${"a".repeat(42)}` }), mockQueryable()),
    "invalid_grant",
  );
  await assertOAuthError(
    consumeAuthorizationCode(consumeInput(), mockQueryable()),
    "invalid_grant",
    /invalid/,
  );
});
