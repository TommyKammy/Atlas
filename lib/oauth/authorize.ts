import { audit as writeAudit } from "@/lib/audit";
import { db, type Queryable } from "@/lib/db";
import { POST_LOGIN_PATH, postLoginCookieHeader } from "@/lib/post-login";
import { resolveClient as resolveRegisteredClient, type OAuthClient } from "./clients";
import {
  issueAuthorizationCode,
  type IssuedAuthorizationCode,
  type IssueAuthorizationCodeInput,
} from "./codes";
import { OAuthError } from "./errors";
import { isValidCodeChallenge } from "./pkce";
import { isLoopbackRedirectUri, redirectUriMatches } from "./redirect";
import {
  MissingPublicBaseUrlError,
  mcpResourceUrlFromBase,
  requestBaseUrl,
  type McpResourceEndpoint,
} from "./resources";
import { normalizeOAuthScopes, parseScopeParameter, type OAuthScope } from "./scopes";

const MAX_DECISION_BODY_BYTES = 64 * 1024;

const PARAMETER_ORDER = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

type ParameterName = (typeof PARAMETER_ORDER)[number];

export type AuthorizeParams = Record<ParameterName, string | null>;

export type AuthorizeRequest = {
  client: OAuthClient;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  /** Scopes as requested by the client (write may be downgraded at consent). */
  scopes: OAuthScope[];
  resource: string;
  endpoint: McpResourceEndpoint;
  /** Normalized public origin used as the RFC 9207 issuer. */
  issuer: string;
  clientName: string;
  clientHost: string | null;
  appKindLabel: string;
  redirectLabel: string;
  permissionLabel: string;
};

export type AuthorizeValidation =
  | { ok: true; request: AuthorizeRequest }
  | {
      ok: false;
      /** A client or redirect problem must never use redirect_uri. */
      fatal: true;
      error: OAuthError;
    }
  | {
      ok: false;
      fatal: false;
      error: OAuthError;
      redirectTo: string;
    };

export type ValidateAuthorizeOptions = {
  baseUrl: string;
  resolveClient?: (clientId: string) => Promise<OAuthClient>;
};

function firstString(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read exactly one value per parameter from the page's searchParams object. */
export function authorizeParamsFromRecord(
  input: Record<string, string | string[] | undefined>,
): AuthorizeParams {
  return {
    response_type: firstString(input.response_type),
    client_id: firstString(input.client_id),
    redirect_uri: firstString(input.redirect_uri),
    code_challenge: firstString(input.code_challenge),
    code_challenge_method: firstString(input.code_challenge_method),
    state: firstString(input.state),
    scope: firstString(input.scope),
    resource: firstString(input.resource),
  };
}

/** Read the POSTed form. Repeated values deliberately collapse to the first. */
export function authorizeParamsFromForm(form: URLSearchParams): AuthorizeParams {
  return {
    response_type: form.get("response_type"),
    client_id: form.get("client_id"),
    redirect_uri: form.get("redirect_uri"),
    code_challenge: form.get("code_challenge"),
    code_challenge_method: form.get("code_challenge_method"),
    state: form.get("state"),
    scope: form.get("scope"),
    resource: form.get("resource"),
  };
}

/** Rebuild the authorization page URL for the post-login cookie. */
export function authorizePathFromParams(params: AuthorizeParams): string {
  const query = new URLSearchParams();
  for (const name of PARAMETER_ORDER) {
    const value = params[name];
    if (value !== null) query.set(name, value);
  }
  const serialized = query.toString();
  return serialized === "" ? POST_LOGIN_PATH : `${POST_LOGIN_PATH}?${serialized}`;
}

function normalizedBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Exact RFC 8707 audience match against the configured public origin. */
export function resourceEndpointForBase(
  resource: string,
  baseUrl: string,
): McpResourceEndpoint | null {
  const base = normalizedBase(baseUrl);
  if (resource === mcpResourceUrlFromBase(base, "default")) return "default";
  if (resource === mcpResourceUrlFromBase(base, "readonly")) return "readonly";
  return null;
}

/** Append parameters without discarding an existing redirect_uri query. */
export function redirectWithParameters(
  redirectUri: string,
  entries: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined) url.searchParams.set(name, value);
  }
  return url.toString();
}

export function authorizeErrorRedirect(
  redirectUri: string,
  error: OAuthError,
  state: string | null,
  issuer: string,
): string {
  return redirectWithParameters(redirectUri, {
    error: error.code,
    error_description: error.message,
    state,
    iss: issuer,
  });
}

function clientHost(clientId: string): string | null {
  try {
    const url = new URL(clientId);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function clientDisplayName(client: OAuthClient, host: string | null): string {
  const name = typeof client.clientName === "string" ? client.clientName.trim() : "";
  if (name !== "") return name;
  return host ?? "動的に登録されたアプリ";
}

function redirectDisplay(redirectUri: string): string {
  if (isLoopbackRedirectUri(redirectUri)) return "このコンピューター上のアプリ";
  try {
    return new URL(redirectUri).host;
  } catch {
    return redirectUri;
  }
}

export function scopeLabel(scopes: OAuthScope[]): string {
  return scopes.includes("write") ? "読み取りと書き込み" : "読み取り";
}

/**
 * Validate an authorization request in the RFC 6749 §4.1.2.1 order:
 * client and redirect_uri first (never redirect for these), then every other
 * parameter (report back through the verified redirect_uri).
 */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  options: ValidateAuthorizeOptions,
): Promise<AuthorizeValidation> {
  const issuer = normalizedBase(options.baseUrl);
  if (params.client_id === null || params.redirect_uri === null) {
    return {
      ok: false,
      fatal: true,
      error: new OAuthError("invalid_request", "client_id and redirect_uri are required"),
    };
  }
  if (params.redirect_uri.length > 2048) {
    return {
      ok: false,
      fatal: true,
      error: new OAuthError("invalid_request", "redirect_uri is invalid"),
    };
  }

  let client: OAuthClient;
  try {
    client = await (options.resolveClient ?? resolveRegisteredClient)(params.client_id);
  } catch {
    return {
      ok: false,
      fatal: true,
      error: new OAuthError("invalid_client", "unknown client"),
    };
  }

  const redirectUri = params.redirect_uri;
  if (!client.redirectUris.some((registered) => redirectUriMatches(registered, redirectUri))) {
    return {
      ok: false,
      fatal: true,
      error: new OAuthError("invalid_request", "redirect_uri is invalid"),
    };
  }

  const redirect = (error: OAuthError): AuthorizeValidation => ({
    ok: false,
    fatal: false,
    error,
    redirectTo: authorizeErrorRedirect(redirectUri, error, params.state, issuer),
  });

  if (params.response_type !== "code") {
    return redirect(new OAuthError("unsupported_response_type", "response_type must be code"));
  }
  if (params.code_challenge === null) {
    return redirect(new OAuthError("invalid_request", "code_challenge is required"));
  }
  if (!isValidCodeChallenge(params.code_challenge)) {
    return redirect(new OAuthError("invalid_request", "code_challenge must be an S256 challenge"));
  }
  if (params.code_challenge_method !== "S256") {
    return redirect(new OAuthError("invalid_request", "code_challenge_method must be S256"));
  }

  let scopes: OAuthScope[] | null;
  if (params.scope === null) {
    scopes = ["read", "write"];
  } else {
    scopes = normalizeOAuthScopes(parseScopeParameter(params.scope));
  }
  if (!scopes) {
    return redirect(new OAuthError("invalid_scope", "scope must include read and only read/write"));
  }

  const resource = params.resource ?? mcpResourceUrlFromBase(issuer, "default");
  const endpoint = resourceEndpointForBase(resource, issuer);
  if (endpoint === null) {
    return redirect(new OAuthError("invalid_target", "resource must identify /mcp or /mcp/readonly"));
  }

  const host = clientHost(params.client_id);
  return {
    ok: true,
    request: {
      client,
      clientId: params.client_id,
      redirectUri,
      codeChallenge: params.code_challenge,
      state: params.state,
      scopes,
      resource,
      endpoint,
      issuer,
      clientName: clientDisplayName(client, host),
      clientHost: host,
      appKindLabel: client.source === "cimd"
        ? `メタデータURL: ${host ?? params.client_id}`
        : "動的に登録されたアプリ",
      redirectLabel: redirectDisplay(redirectUri),
      permissionLabel: scopeLabel(scopes),
    },
  };
}

/** Workspace switches needed by the consent screen and code issuance. */
export async function loadAuthorizeWorkspace(
  q: Queryable = db,
): Promise<{ workspaceId: number; mcpEnabled: boolean } | null> {
  const result = await q.query(
    `SELECT workspace_id, mcp_enabled
     FROM workspace_security
     ORDER BY workspace_id
     LIMIT 1`,
  );
  const row = result.rows[0] as
    | { workspace_id: number; mcp_enabled: boolean | null }
    | undefined;
  if (!row) return null;
  return {
    workspaceId: Number(row.workspace_id),
    mcpEnabled: row.mcp_enabled === true,
  };
}

export type AuthorizeSession = {
  user: { id: number; name: string; isGuest: boolean };
  mfaPending: boolean;
};

export type AuthorizeDecisionDependencies = {
  loadSession: (req: Request) => Promise<AuthorizeSession | null>;
  baseUrl?: string;
  resolveClient?: (clientId: string) => Promise<OAuthClient>;
  loadWorkspace?: () => Promise<{ workspaceId: number; mcpEnabled: boolean } | null>;
  issueCode?: (input: IssueAuthorizationCodeInput) => Promise<IssuedAuthorizationCode>;
  audit?: typeof writeAudit;
};

export function originMatchesBase(req: Request, baseUrl: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === normalizedBase(baseUrl);
  } catch {
    return false;
  }
}

function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "cache-control": "no-store", pragma: "no-cache", ...extra };
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: noStoreHeaders({ location }),
  });
}

function redirectWithPostLogin(location: string, path: string): Response {
  const response = redirectResponse(location);
  response.headers.append("set-cookie", postLoginCookieHeader(path));
  return response;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Finish a consent POST with a same-origin 200 page instead of a cross-origin
 * 303. The CSP form-action directive also constrains the redirect target of a
 * form submission, so an external 303 is blocked by the browser. A meta
 * refresh is an ordinary navigation and leaves form-action untouched. The
 * page contains no script and the authorization code never appears in a
 * Referer because the response forbids one.
 */
function completionPageResponse(location: string): Response {
  const href = escapeHtml(location);
  const body = `<!doctype html><html lang="ja"><head><meta charset="utf-8">`
    + `<meta name="referrer" content="no-referrer">`
    + `<meta http-equiv="refresh" content="0;url=${href}">`
    + `<title>接続を完了しています…</title></head><body>`
    + `<main><h1>接続を完了しています…</h1>`
    + `<p>自動的に元のアプリへ戻ります。このタブは閉じて構いません。</p>`
    + `<p><a href="${href}" rel="noreferrer">自動的に戻らない場合はこちら</a></p>`
    + `</main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: noStoreHeaders({
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
    }),
  });
}

function errorResponse(status: number, message: string): Response {
  const body = `<!doctype html><html lang="ja"><head><meta charset="utf-8">`
    + `<title>Atlas に接続できません</title></head><body>`
    + `<main><h1>Atlas に接続できません</h1><p>${escapeHtml(message)}</p></main>`
    + `</body></html>`;
  return new Response(body, {
    status,
    headers: noStoreHeaders({ "content-type": "text/html; charset=utf-8" }),
  });
}

async function readDecisionForm(req: Request): Promise<URLSearchParams | null> {
  const contentType = req.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") return null;
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DECISION_BODY_BYTES) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_DECISION_BODY_BYTES) return null;
  return new URLSearchParams(text);
}

function decisionCompletion(
  request: AuthorizeRequest,
  entries: Record<string, string | null | undefined>,
): Response {
  return completionPageResponse(redirectWithParameters(request.redirectUri, entries));
}

/**
 * POST handler for the consent screen. Origin is checked first; the request is
 * then validated exactly like the GET, so hidden form fields cannot weaken the
 * client, redirect_uri, PKCE, scope or resource checks. The session cookie is
 * SameSite=Lax, so a cross-site form cannot authenticate even if Origin were
 * spoofed by a non-browser client.
 */
export async function handleAuthorizeDecision(
  req: Request,
  deps: AuthorizeDecisionDependencies,
): Promise<Response> {
  let baseUrl: string;
  try {
    baseUrl = normalizedBase(deps.baseUrl ?? requestBaseUrl(req));
  } catch (error) {
    if (error instanceof MissingPublicBaseUrlError) {
      return errorResponse(500, "サーバーの公開 URL が設定されていません。管理者に連絡してください。");
    }
    throw error;
  }

  // CSRF: a browser form must carry an Origin that matches this server. A
  // missing Origin is rejected rather than treated as same-origin.
  if (!originMatchesBase(req, baseUrl)) {
    return errorResponse(403, "このリクエストは受け付けられません。");
  }

  let form: URLSearchParams | null;
  try {
    form = await readDecisionForm(req);
  } catch {
    return errorResponse(400, "リクエストの内容を読み取れませんでした。");
  }
  if (!form) return errorResponse(400, "リクエストの形式が正しくありません。");

  const action = form.get("action");
  if (action !== "allow" && action !== "deny") {
    return errorResponse(400, "許可または拒否を選択してください。");
  }

  const params = authorizeParamsFromForm(form);
  const validation = await validateAuthorizeRequest(params, {
    baseUrl,
    resolveClient: deps.resolveClient,
  });
  if (!validation.ok) {
    // A broken client/redirect must never receive a redirect, even from POST.
    if (validation.fatal) return errorResponse(400, "認可リクエストが無効です。");
    return completionPageResponse(validation.redirectTo);
  }
  const request = validation.request;

  const session = await deps.loadSession(req);
  if (!session) {
    return redirectWithPostLogin("/login", authorizePathFromParams(params));
  }
  if (session.mfaPending) {
    return redirectWithPostLogin("/profile#two-factor", authorizePathFromParams(params));
  }
  if (session.user.isGuest) {
    return decisionCompletion(request, {
      error: "access_denied",
      state: request.state,
      iss: request.issuer,
    });
  }

  const workspace = await (deps.loadWorkspace ?? loadAuthorizeWorkspace)();
  if (!workspace || !workspace.mcpEnabled) {
    return errorResponse(403, "管理者が MCP 接続を有効にすると利用できます。");
  }

  if (action === "deny") {
    return decisionCompletion(request, {
      error: "access_denied",
      state: request.state,
      iss: request.issuer,
    });
  }

  const readOnly = request.endpoint === "readonly" || form.get("read_only") === "1";
  const scopes: OAuthScope[] = readOnly ? ["read"] : request.scopes;
  const issue = deps.issueCode ?? issueAuthorizationCode;
  const issued = await issue({
    clientId: request.clientId,
    userId: session.user.id,
    workspaceId: workspace.workspaceId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: "S256",
    scopes,
    resource: request.resource,
  });

  await (deps.audit ?? writeAudit)(session.user.id, "oauth.consent", {
    entity: "oauth_client",
    workspaceId: workspace.workspaceId,
    summary: `OAuth 接続を承認: ${request.clientName}（${scopeLabel(scopes)}）`,
  });

  return decisionCompletion(request, {
    code: issued.code,
    state: request.state,
    iss: request.issuer,
  });
}
