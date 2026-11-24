import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthClient } from "./clients";
import {
  authorizeErrorRedirect,
  authorizeParamsFromForm,
  handleAuthorizeDecision,
  redirectWithParameters,
  validateAuthorizeRequest,
  type AuthorizeDecisionDependencies,
  type AuthorizeParams,
  type AuthorizeSession,
} from "./authorize";
import type { IssueAuthorizationCodeInput } from "./codes";
import { OAuthError } from "./errors";

const BASE = "https://atlas.test";
const CLIENT_ID = "https://client.example/oauth/client.json";
const REDIRECT_URI = "http://127.0.0.1:5555/callback";
const CHALLENGE = "a".repeat(43);
const CODE = `atlas_oac_${"c".repeat(43)}`;

function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    clientId: CLIENT_ID,
    source: "cimd",
    clientName: "Example Client",
    redirectUris: [REDIRECT_URI],
    applicationType: "native",
    metadata: {},
    fetchedAt: null,
    ...overrides,
  };
}

function validParams(overrides: Partial<AuthorizeParams> = {}): AuthorizeParams {
  return {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "read write",
    resource: `${BASE}/mcp`,
    ...overrides,
  };
}

function formFor(overrides: Record<string, string | null> = {}): URLSearchParams {
  const values: Record<string, string | null> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "read write",
    resource: `${BASE}/mcp`,
    action: "allow",
    ...overrides,
  };
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) form.set(name, value);
  }
  return form;
}

function decisionRequest(
  form: URLSearchParams,
  { origin = BASE, omitOrigin = false }: { origin?: string; omitOrigin?: boolean } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (!omitOrigin) headers.origin = origin;
  return new Request(`${BASE}/oauth/authorize/decision`, {
    method: "POST",
    headers,
    body: form.toString(),
  });
}

type Recorded = {
  sessions: number;
  issued: IssueAuthorizationCodeInput[];
  audits: { actorId: number | null; action: string; opts: Record<string, unknown> }[];
};

function dependencies(
  recorded: Recorded,
  overrides: Partial<AuthorizeDecisionDependencies> = {},
): AuthorizeDecisionDependencies {
  const loadSession: AuthorizeDecisionDependencies["loadSession"] = async () => {
    recorded.sessions += 1;
    return {
      user: { id: 7, name: "Alice", isGuest: false },
      mfaPending: false,
    } satisfies AuthorizeSession;
  };
  return {
    baseUrl: BASE,
    resolveClient: async () => makeClient(),
    loadSession,
    loadWorkspace: async () => ({ workspaceId: 1, mcpEnabled: true }),
    issueCode: async (input) => {
      recorded.issued.push(input);
      return {
        code: CODE,
        familyId: "00000000-0000-4000-8000-000000000001",
        expiresAt: "2026-11-24T00:10:00.000Z",
      };
    },
    audit: async (actorId, action, opts) => {
      recorded.audits.push({ actorId, action, opts: opts as unknown as Record<string, unknown> });
    },
    ...overrides,
  };
}

function newRecorded(): Recorded {
  return { sessions: 0, issued: [], audits: [] };
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function completionTarget(response: Response): Promise<{
  body: string;
  url: URL;
  link: URL;
}> {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const body = await response.text();
  const meta = body.match(/<meta http-equiv="refresh" content="0;url=([^"]*)">/);
  assert.ok(meta, "completion page must contain a meta refresh");
  const anchor = body.match(/<a href="([^"]*)" rel="noreferrer">/);
  assert.ok(anchor, "completion page must contain a manual link");
  return {
    body,
    url: new URL(decodeHtmlAttribute(meta[1])),
    link: new URL(decodeHtmlAttribute(anchor[1])),
  };
}

test("an unknown client and a redirect mismatch never redirect", async () => {
  const unknown = await validateAuthorizeRequest(validParams(), {
    baseUrl: BASE,
    resolveClient: async () => {
      throw new OAuthError("invalid_client", "unknown client");
    },
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.fatal, true);
  assert.equal("redirectTo" in unknown, false);
  assert.equal(unknown.error.code, "invalid_client");

  const mismatch = await validateAuthorizeRequest(
    validParams({ redirect_uri: "http://127.0.0.1:5555/other" }),
    { baseUrl: BASE, resolveClient: async () => makeClient() },
  );
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.fatal, true);
  assert.equal("redirectTo" in mismatch, false);
});

test("parameter errors return through the verified redirect_uri with state and iss", async () => {
  const cases: { overrides: Partial<AuthorizeParams>; error: string }[] = [
    { overrides: { response_type: "token" }, error: "unsupported_response_type" },
    { overrides: { code_challenge: null }, error: "invalid_request" },
    { overrides: { code_challenge: "short" }, error: "invalid_request" },
    { overrides: { code_challenge_method: "plain" }, error: "invalid_request" },
    { overrides: { scope: "read admin" }, error: "invalid_scope" },
    { overrides: { scope: "write" }, error: "invalid_scope" },
    { overrides: { resource: `${BASE}/other` }, error: "invalid_target" },
  ];

  for (const entry of cases) {
    const result = await validateAuthorizeRequest(validParams(entry.overrides), {
      baseUrl: BASE,
      resolveClient: async () => makeClient(),
    });
    assert.equal(result.ok, false, entry.error);
    if (result.ok) continue;
    assert.equal(result.fatal, false);
    assert.equal(result.error.code, entry.error);
    const redirect = new URL(result.redirectTo);
    assert.equal(redirect.searchParams.get("error"), entry.error);
    assert.ok(redirect.searchParams.get("error_description"));
    assert.equal(redirect.searchParams.get("state"), "state-123");
    assert.equal(redirect.searchParams.get("iss"), BASE);
  }
});

test("omitted scope and resource use the read/write default and /mcp", async () => {
  const result = await validateAuthorizeRequest(
    validParams({ scope: null, resource: null }),
    { baseUrl: BASE, resolveClient: async () => makeClient() },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request.scopes, ["read", "write"]);
  assert.equal(result.request.resource, `${BASE}/mcp`);
  assert.equal(result.request.endpoint, "default");
  assert.equal(result.request.clientName, "Example Client");
  assert.equal(result.request.appKindLabel, "メタデータURL: client.example");
  assert.equal(result.request.redirectLabel, "このコンピューター上のアプリ");
  assert.equal(result.request.permissionLabel, "読み取りと書き込み");
});

test("a DCR client without metadata uses the registered-app wording", async () => {
  const result = await validateAuthorizeRequest(
    validParams({ client_id: "atlas_oauth_opaque" }),
    {
      baseUrl: BASE,
      resolveClient: async () => makeClient({
        clientId: "atlas_oauth_opaque",
        source: "dcr",
        clientName: null,
      }),
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.request.clientName, "動的に登録されたアプリ");
  assert.equal(result.request.appKindLabel, "動的に登録されたアプリ");
  assert.equal(result.request.clientHost, null);
});

test("redirect parameter appending preserves an existing query", () => {
  assert.equal(
    redirectWithParameters("https://app.example/cb?tenant=1", { code: "x", state: null }),
    "https://app.example/cb?tenant=1&code=x",
  );
  const error = authorizeErrorRedirect(
    "https://app.example/cb?tenant=1",
    new OAuthError("access_denied", "denied"),
    "s",
    BASE,
  );
  const url = new URL(error);
  assert.equal(url.searchParams.get("tenant"), "1");
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("iss"), BASE);
});

test("POST rejects a missing or cross-origin Origin with 403 before any work", async () => {
  for (const request of [
    decisionRequest(formFor(), { origin: "https://evil.example" }),
    decisionRequest(formFor(), { omitOrigin: true }),
  ]) {
    const recorded = newRecorded();
    const response = await handleAuthorizeDecision(request, dependencies(recorded));
    assert.equal(response.status, 403);
    assert.equal(recorded.sessions, 0);
    assert.equal(recorded.issued.length, 0);
  }
});

test("allowing consent issues a code and completes with a meta refresh", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor()),
    dependencies(recorded),
  );
  const completion = await completionTarget(response);
  assert.equal(completion.url.searchParams.get("code"), CODE);
  assert.equal(completion.url.searchParams.get("state"), "state-123");
  assert.equal(completion.url.searchParams.get("iss"), BASE);
  assert.equal(completion.link.toString(), completion.url.toString());

  assert.equal(recorded.issued.length, 1);
  const issued = recorded.issued[0];
  assert.deepEqual(issued.scopes, ["read", "write"]);
  assert.equal(issued.clientId, CLIENT_ID);
  assert.equal(issued.userId, 7);
  assert.equal(issued.workspaceId, 1);
  assert.equal(issued.redirectUri, REDIRECT_URI);
  assert.equal(issued.resource, `${BASE}/mcp`);
  assert.equal(issued.codeChallengeMethod, "S256");

  assert.equal(recorded.audits.length, 1);
  assert.equal(recorded.audits[0].actorId, 7);
  assert.equal(recorded.audits[0].action, "oauth.consent");
  assert.equal(recorded.audits[0].opts.workspaceId, 1);
  assert.match(String(recorded.audits[0].opts.summary), /Example Client/);
  assert.match(String(recorded.audits[0].opts.summary), /読み取りと書き込み/);
});

test("choosing read-only downgrades the issued scope to read", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ read_only: "1" })),
    dependencies(recorded),
  );
  await completionTarget(response);
  assert.deepEqual(recorded.issued[0].scopes, ["read"]);
  assert.match(String(recorded.audits[0].opts.summary), /読み取り）/);
});

test("the readonly endpoint refuses write even when the client requested it", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ resource: `${BASE}/mcp/readonly` })),
    dependencies(recorded),
  );
  await completionTarget(response);
  assert.deepEqual(recorded.issued[0].scopes, ["read"]);
  assert.equal(recorded.issued[0].resource, `${BASE}/mcp/readonly`);
});

test("denying consent returns access_denied without issuing a code", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ action: "deny" })),
    dependencies(recorded),
  );
  const completion = await completionTarget(response);
  assert.equal(completion.url.searchParams.get("error"), "access_denied");
  assert.equal(completion.url.searchParams.get("state"), "state-123");
  assert.equal(completion.url.searchParams.get("iss"), BASE);
  assert.equal(recorded.issued.length, 0);
  assert.equal(recorded.audits.length, 0);
});

test("guests are denied through the verified redirect", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor()),
    dependencies(recorded, {
      loadSession: async () => ({
        user: { id: 9, name: "Guest", isGuest: true },
        mfaPending: false,
      }),
    }),
  );
  const completion = await completionTarget(response);
  assert.equal(completion.url.searchParams.get("error"), "access_denied");
  assert.equal(recorded.issued.length, 0);
});

test("the completion page escapes URL attributes and contains no script", async () => {
  const webRedirect = "https://app.example/callback?tenant=1";
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ redirect_uri: webRedirect })),
    dependencies(recorded, {
      resolveClient: async () => makeClient({
        redirectUris: [webRedirect],
        applicationType: "web",
      }),
    }),
  );
  const completion = await completionTarget(response);
  assert.ok(completion.body.includes("&amp;code="));
  assert.ok(!completion.body.includes("&code="));
  assert.ok(!completion.body.includes("<script"));
  assert.equal(completion.url.searchParams.get("code"), CODE);
});

test("a nonfatal POST validation error completes through the meta refresh", async () => {
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ scope: "write" })),
    dependencies(recorded),
  );
  const completion = await completionTarget(response);
  assert.equal(completion.url.searchParams.get("error"), "invalid_scope");
  assert.equal(completion.url.searchParams.get("state"), "state-123");
  assert.equal(completion.url.searchParams.get("iss"), BASE);
  assert.equal(recorded.issued.length, 0);
});

test("MFA-pending and logged-out sessions are sent to the right screen with the return cookie", async () => {
  const pending = newRecorded();
  const pendingResponse = await handleAuthorizeDecision(
    decisionRequest(formFor()),
    dependencies(pending, {
      loadSession: async () => ({
        user: { id: 7, name: "Alice", isGuest: false },
        mfaPending: true,
      }),
    }),
  );
  assert.equal(pendingResponse.status, 303);
  assert.equal(pendingResponse.headers.get("location"), "/profile#two-factor");
  assert.match(pendingResponse.headers.get("set-cookie") ?? "", /atlas_post_login=/);

  const loggedOut = newRecorded();
  const loggedOutResponse = await handleAuthorizeDecision(
    decisionRequest(formFor()),
    dependencies(loggedOut, { loadSession: async () => null }),
  );
  assert.equal(loggedOutResponse.status, 303);
  assert.equal(loggedOutResponse.headers.get("location"), "/login");
  assert.match(loggedOutResponse.headers.get("set-cookie") ?? "", /atlas_post_login=/);
  assert.equal(loggedOut.issued.length, 0);
});

test("a disabled workspace or a fatal parameter error never issues a code", async () => {
  const disabled = newRecorded();
  const disabledResponse = await handleAuthorizeDecision(
    decisionRequest(formFor()),
    dependencies(disabled, {
      loadWorkspace: async () => ({ workspaceId: 1, mcpEnabled: false }),
    }),
  );
  assert.equal(disabledResponse.status, 403);
  assert.equal(disabled.issued.length, 0);

  const fatal = newRecorded();
  const fatalResponse = await handleAuthorizeDecision(
    decisionRequest(formFor({ client_id: "https://unknown.example/client.json" })),
    dependencies(fatal, {
      resolveClient: async () => {
        throw new OAuthError("invalid_client", "unknown client");
      },
    }),
  );
  assert.equal(fatalResponse.status, 400);
  assert.equal(fatalResponse.headers.get("location"), null);
  assert.equal(fatal.issued.length, 0);
});

test("a successful POST keeps the redirect_uri's existing query", async () => {
  const webRedirect = "https://app.example/callback?tenant=1";
  const recorded = newRecorded();
  const response = await handleAuthorizeDecision(
    decisionRequest(formFor({ redirect_uri: webRedirect })),
    dependencies(recorded, {
      resolveClient: async () => makeClient({
        redirectUris: [webRedirect],
        applicationType: "web",
      }),
    }),
  );
  const completion = await completionTarget(response);
  assert.equal(completion.url.searchParams.get("tenant"), "1");
  assert.equal(completion.url.searchParams.get("code"), CODE);
});

test("the form parser reads the same parameters the page rendered", () => {
  assert.deepEqual(authorizeParamsFromForm(formFor()), validParams());
});
