import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { AuthRateLimitError } from "@/lib/auth-rate-limit";
import type { Queryable } from "@/lib/db";
import { hashMcpToken } from "@/lib/mcp/token";
import type { OAuthClient } from "./clients";
import { OAuthError } from "./errors";
import {
  handleClientRegistration,
  handleRevocationRequest,
  handleTokenRequest,
  type OAuthHttpDependencies,
} from "./http";
import { s256Challenge } from "./pkce";

process.env.APP_URL = "https://atlas.test";

const CLIENT_ID = "atlas_oauth_testclient";
const CLIENT_NAME = "Example Client";
const CODE = `atlas_oac_${"a".repeat(43)}`;
const VERIFIER = "v".repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);
const REFRESH_TOKEN = `atlas_ort_${"b".repeat(43)}`;
const FAMILY_ID = randomUUID();
const REDIRECT_URI = "http://127.0.0.1:5555/callback";
const RESOURCE = "https://atlas.test/mcp";
const READONLY_RESOURCE = "https://atlas.test/mcp/readonly";

type Call = { sql: string; params?: unknown[] };

type State = {
  codeRow: Record<string, unknown> | null;
  codeUpdateCount: number;
  refreshFound: boolean;
  refreshRow: Record<string, unknown> | null;
  refreshUsedUpdateCount: number;
  guest: boolean;
  deactivated: boolean;
  mcpEnabled: boolean;
  calls: Call[];
};

function createState(overrides: Partial<State> = {}): State {
  return {
    codeRow: null,
    codeUpdateCount: 1,
    refreshFound: false,
    refreshRow: null,
    refreshUsedUpdateCount: 1,
    guest: false,
    deactivated: false,
    mcpEnabled: true,
    calls: [],
    ...overrides,
  };
}

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

function createTransactionStore(state: State): Queryable {
  return {
    query: async (sql, params) => {
      state.calls.push({ sql, params });
      if (sql.includes("FROM oauth_authorization_codes")) {
        return result(state.codeRow ? [state.codeRow] : []);
      }
      if (sql.includes("UPDATE oauth_authorization_codes SET used_at")) {
        return result([], state.codeUpdateCount);
      }
      if (sql.includes("FROM users u")) {
        return result([{
          id: 42,
          deactivated_at: state.deactivated ? new Date() : null,
          is_guest: state.guest,
          mcp_enabled: state.mcpEnabled,
        }]);
      }
      if (sql.includes("INSERT INTO mcp_tokens")) {
        return result([{ id: 101, expires_at: "2026-11-25T00:00:00Z" }]);
      }
      if (sql.includes("INSERT INTO oauth_refresh_tokens")) {
        return result([{ id: 102, expires_at: "2026-12-24T00:00:00Z" }]);
      }
      if (sql.includes("FROM oauth_refresh_tokens")
          && sql.includes("WHERE token_hash = $1")) {
        return result(state.refreshFound ? [{ id: 55, user_id: 42, workspace_id: 1 }] : []);
      }
      if (sql.includes("FROM oauth_refresh_tokens rt")) {
        return result(state.refreshRow ? [state.refreshRow] : []);
      }
      if (sql.includes("UPDATE oauth_refresh_tokens SET used_at")) {
        return result([], state.refreshUsedUpdateCount);
      }
      if (sql.includes("UPDATE mcp_tokens SET revoked_at")) return result([], 1);
      if (sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")) return result([], 1);
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const UNUSED_STORE: Queryable = {
  query: async () => {
    throw new Error("the endpoint must not touch the store outside the injected dependency");
  },
};

const CLIENT: OAuthClient = {
  clientId: CLIENT_ID,
  source: "dcr",
  clientName: CLIENT_NAME,
  redirectUris: [REDIRECT_URI],
  applicationType: "native",
  metadata: {},
  fetchedAt: null,
};

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

function refreshRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 55,
    family_id: FAMILY_ID,
    client_id: CLIENT_ID,
    user_id: 42,
    workspace_id: 1,
    scopes: ["read", "write"],
    resource: RESOURCE,
    expires_at: new Date(Date.now() + 24 * 60 * 60_000),
    used_at: null,
    revoked_at: null,
    client_name: CLIENT_NAME,
    client_revoked_at: null,
    ...overrides,
  };
}

type Fixture = {
  state: State;
  deps: OAuthHttpDependencies;
  transactionCount: () => number;
};

function fixture(
  state: State,
  overrides: Partial<OAuthHttpDependencies> = {},
): Fixture {
  const tx = createTransactionStore(state);
  let transactions = 0;
  const transaction: NonNullable<OAuthHttpDependencies["transaction"]> =
    async <T>(fn: (q: Queryable) => Promise<T>): Promise<T> => {
      transactions += 1;
      return fn(tx);
    };
  return {
    state,
    deps: {
      store: UNUSED_STORE,
      transaction,
      limit: async () => undefined,
      resolve: async (clientId) => {
        assert.equal(clientId, CLIENT_ID);
        return CLIENT;
      },
      ...overrides,
    },
    transactionCount: () => transactions,
  };
}

function formRequest(fields: Record<string, string>): Request {
  return new Request("https://atlas.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams(fields).toString(),
  });
}

function registerRequest(body: unknown): Request {
  return new Request("https://atlas.test/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function revokeRequest(body: string): Request {
  return new Request("https://atlas.test/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function assertNoStore(response: Response): void {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
}

async function errorBody(
  response: Response,
  status: number,
  code: string,
): Promise<{ error: string; error_description?: string }> {
  assert.equal(response.status, status);
  const body = await response.json() as { error: string; error_description?: string };
  assert.equal(body.error, code);
  return body;
}

function insertCalls(state: State): Call[] {
  return state.calls.filter((call) => call.sql.includes("INSERT INTO"));
}

// ---- Client registration (RFC 7591) ---------------------------------------

test("register returns 201 with the RFC 7591 client information", async () => {
  let received: unknown;
  const response = await handleClientRegistration(registerRequest({
    redirect_uris: [REDIRECT_URI],
    application_type: "native",
  }), {
    limit: async (scope) => {
      assert.equal(scope, "oauth-register");
    },
    register: async (input) => {
      received = input;
      return {
        client_id: CLIENT_ID,
        client_id_issued_at: 1_764_000_000,
        client_name: CLIENT_NAME,
        redirect_uris: [REDIRECT_URI],
        application_type: "native",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
      };
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(received, {
    redirect_uris: [REDIRECT_URI],
    application_type: "native",
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.client_id, CLIENT_ID);
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.deepEqual(body.redirect_uris, [REDIRECT_URI]);
});

test("register maps redirect and metadata validation failures to 400", async () => {
  for (const [code, message] of [
    ["invalid_redirect_uri", "native clients require loopback redirect_uris"],
    ["invalid_client_metadata", "token_endpoint_auth_method must be none"],
  ] as const) {
    const response = await handleClientRegistration(registerRequest({}), {
      limit: async () => undefined,
      register: async () => {
        throw new OAuthError(code, message);
      },
    });
    const body = await errorBody(response, 400, code);
    assert.equal(body.error_description, message);
  }

  const malformed = await handleClientRegistration(new Request("https://atlas.test/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }), { limit: async () => undefined });
  await errorBody(malformed, 400, "invalid_client_metadata");
});

test("register applies the IP rate limit and returns the existing 429 response", async () => {
  const response = await handleClientRegistration(registerRequest({}), {
    limit: async (scope) => {
      assert.equal(scope, "oauth-register");
      throw new AuthRateLimitError(20);
    },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "20");
  assert.deepEqual(await response.json(), {
    error: "too_many_attempts",
    retry_after_seconds: 20,
  });
});

// ---- Token endpoint -------------------------------------------------------

test("the token endpoint rejects JSON and non-form content types with 400", async () => {
  const response = await handleTokenRequest(new Request("https://atlas.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code" }),
  }), { limit: async () => undefined });
  await errorBody(response, 400, "invalid_request");
  assertNoStore(response);
});

test("a missing or unsupported grant_type is rejected without a transaction", async () => {
  const missing = fixture(createState());
  await errorBody(
    await handleTokenRequest(formRequest({}), missing.deps),
    400,
    "invalid_request",
  );
  assert.equal(missing.transactionCount(), 0);

  const unsupported = fixture(createState());
  const body = await errorBody(
    await handleTokenRequest(formRequest({ grant_type: "password" }), unsupported.deps),
    400,
    "unsupported_grant_type",
  );
  assert.equal(body.error_description, "grant_type is not supported");
  assert.equal(unsupported.transactionCount(), 0);
});

test("authorization_code consumes and issues in one transaction with the code's family", async () => {
  const state = createState({ codeRow: codeRow() });
  const { deps, transactionCount } = fixture(state);
  const response = await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
    resource: RESOURCE,
  }), deps);

  assert.equal(response.status, 200);
  assertNoStore(response);
  const body = await response.json() as Record<string, unknown>;
  assert.match(String(body.access_token), /^atlas_oat_[A-Za-z0-9_-]{43}$/);
  assert.match(String(body.refresh_token), /^atlas_ort_[A-Za-z0-9_-]{43}$/);
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.expires_in, 86_400);
  assert.equal(body.scope, "read write");

  assert.equal(transactionCount(), 1);
  const codeUpdate = state.calls.find((call) =>
    call.sql.includes("UPDATE oauth_authorization_codes SET used_at"));
  assert.ok(codeUpdate);
  const accessInsert = state.calls.find((call) => call.sql.includes("INSERT INTO mcp_tokens"));
  const refreshInsert = state.calls.find((call) =>
    call.sql.includes("INSERT INTO oauth_refresh_tokens"));
  assert.ok(accessInsert);
  assert.ok(refreshInsert);
  assert.equal(accessInsert.params?.[8], FAMILY_ID);
  assert.equal(refreshInsert.params?.[1], FAMILY_ID);
});

test("authorization_code without resource uses the code's stored audience", async () => {
  const state = createState({ codeRow: codeRow() });
  const { deps } = fixture(state);
  const response = await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
  }), deps);

  assert.equal(response.status, 200);
  const accessInsert = state.calls.find((call) => call.sql.includes("INSERT INTO mcp_tokens"));
  assert.ok(accessInsert);
  assert.equal(accessInsert.params?.[6], RESOURCE);
});

test("a PKCE mismatch is invalid_grant without exposing the internal reason", async () => {
  const state = createState({ codeRow: codeRow() });
  const { deps, transactionCount } = fixture(state);
  const response = await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: "w".repeat(43),
  }), deps);

  const body = await errorBody(response, 400, "invalid_grant");
  assert.equal(body.error_description, "authorization grant is invalid");
  assertNoStore(response);
  assert.equal(transactionCount(), 1);
  assert.equal(insertCalls(state).length, 0);
});

test("an expired authorization code is invalid_grant", async () => {
  const state = createState({
    codeRow: codeRow({ expires_at: new Date(Date.now() - 1_000) }),
  });
  const { deps } = fixture(state);
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
  }), deps), 400, "invalid_grant");
  assert.equal(insertCalls(state).length, 0);
});

test("a replayed authorization code is rejected and commits the family revocation", async () => {
  const state = createState({ codeRow: codeRow({ used_at: new Date() }) });
  const { deps, transactionCount } = fixture(state);
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
  }), deps), 400, "invalid_grant");

  assert.equal(transactionCount(), 1);
  assert.equal(insertCalls(state).length, 0);
  const accessRevoke = state.calls.find((call) =>
    call.sql.includes("UPDATE mcp_tokens SET revoked_at"));
  const refreshRevoke = state.calls.find((call) =>
    call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at"));
  assert.ok(accessRevoke);
  assert.ok(refreshRevoke);
  assert.deepEqual(accessRevoke.params, [FAMILY_ID]);
  assert.deepEqual(refreshRevoke.params, [FAMILY_ID]);
});

test("a resource mismatch is invalid_target and does not consume the code", async () => {
  const state = createState({ codeRow: codeRow() });
  const { deps, transactionCount } = fixture(state);
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
    resource: READONLY_RESOURCE,
  }), deps), 400, "invalid_target");
  assert.equal(transactionCount(), 1);
  assert.ok(!state.calls.some((call) =>
    call.sql.includes("UPDATE oauth_authorization_codes SET used_at")));
  assert.equal(insertCalls(state).length, 0);

  const unsupported = fixture(createState({ codeRow: codeRow() }));
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
    resource: "https://other.example/mcp",
  }), unsupported.deps), 400, "invalid_target");
  assert.equal(unsupported.transactionCount(), 0);
});

test("an unknown client is invalid_client with 401", async () => {
  const { deps, transactionCount } = fixture(createState({ codeRow: codeRow() }), {
    resolve: async () => {
      throw new OAuthError("invalid_client", "unknown client");
    },
  });
  const response = await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: "atlas_oauth_unknown",
    code_verifier: VERIFIER,
  }), deps);
  const body = await errorBody(response, 401, "invalid_client");
  assert.equal(body.error_description, "client authentication failed");
  assert.equal(transactionCount(), 0);
});

test("a guest is denied with 403 access_denied", async () => {
  const state = createState({ codeRow: codeRow(), guest: true });
  const { deps } = fixture(state);
  const response = await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: VERIFIER,
  }), deps);
  const body = await errorBody(response, 403, "access_denied");
  assert.equal(body.error_description, "access denied");
  assertNoStore(response);
});

test("missing authorization_code parameters are invalid_request", async () => {
  const { deps, transactionCount } = fixture(createState());
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
  }), deps), 400, "invalid_request");
  assert.equal(transactionCount(), 0);
});

test("refresh_token rotates the token in the same family", async () => {
  const state = createState({
    refreshFound: true,
    refreshRow: refreshRow(),
  });
  const { deps, transactionCount } = fixture(state);
  const response = await handleTokenRequest(formRequest({
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  }), deps);

  assert.equal(response.status, 200);
  assertNoStore(response);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.expires_in, 86_400);
  assert.equal(body.scope, "read write");
  assert.match(String(body.refresh_token), /^atlas_ort_/);

  assert.equal(transactionCount(), 1);
  assert.ok(state.calls.some((call) =>
    call.sql.includes("UPDATE oauth_refresh_tokens SET used_at")));
  const refreshInsert = state.calls.find((call) =>
    call.sql.includes("INSERT INTO oauth_refresh_tokens"));
  assert.ok(refreshInsert);
  assert.equal(refreshInsert.params?.[1], FAMILY_ID);
});

test("refresh reuse is invalid_grant and commits the family revocation", async () => {
  const state = createState({
    refreshFound: true,
    refreshRow: refreshRow({ used_at: new Date() }),
  });
  const { deps, transactionCount } = fixture(state);
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
  }), deps), 400, "invalid_grant");

  assert.equal(transactionCount(), 1);
  assert.equal(insertCalls(state).length, 0);
  assert.ok(state.calls.some((call) =>
    call.sql.includes("UPDATE mcp_tokens SET revoked_at")));
  assert.ok(state.calls.some((call) =>
    call.sql.includes("UPDATE oauth_refresh_tokens SET revoked_at")));
});

test("refresh with a different resource is invalid_target", async () => {
  const state = createState({
    refreshFound: true,
    refreshRow: refreshRow(),
  });
  const { deps } = fixture(state);
  await errorBody(await handleTokenRequest(formRequest({
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    resource: READONLY_RESOURCE,
  }), deps), 400, "invalid_target");
  assert.ok(!state.calls.some((call) =>
    call.sql.includes("UPDATE oauth_refresh_tokens SET used_at")));
});

test("the token endpoint rate limit returns 429 with no-store headers", async () => {
  const response = await handleTokenRequest(formRequest({ grant_type: "authorization_code" }), {
    limit: async (scope) => {
      assert.equal(scope, "oauth-token");
      throw new AuthRateLimitError(30);
    },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assertNoStore(response);
});

// ---- Revocation (RFC 7009) ------------------------------------------------

test("revoke returns 200 even when the token does not exist", async () => {
  let received: string | null = null;
  const response = await handleRevocationRequest(
    revokeRequest(new URLSearchParams({
      token: `atlas_oat_${"c".repeat(43)}`,
      client_id: CLIENT_ID,
    }).toString()),
    {
      revoke: async (token) => {
        received = token;
        return false;
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(received, `atlas_oat_${"c".repeat(43)}`);
  assert.equal(await response.text(), "");
  assertNoStore(response);
});

test("revoke requires token and client_id and form encoding", async () => {
  const missingToken = await handleRevocationRequest(
    revokeRequest(new URLSearchParams({ client_id: CLIENT_ID }).toString()),
  );
  await errorBody(missingToken, 400, "invalid_request");

  const missingClient = await handleRevocationRequest(
    revokeRequest(new URLSearchParams({ token: "anything" }).toString()),
  );
  await errorBody(missingClient, 400, "invalid_request");

  const json = await handleRevocationRequest(new Request("https://atlas.test/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "anything", client_id: CLIENT_ID }),
  }));
  await errorBody(json, 400, "invalid_request");
});
