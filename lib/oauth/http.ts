import { authRateLimitResponse, POLICIES, reserveAuthAttempt } from "@/lib/auth-rate-limit";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import { db, withTransaction, type Queryable } from "@/lib/db";
import {
  registerClient,
  resolveClient,
  type OAuthClient,
  type RegisterClientResponse,
} from "./clients";
import { consumeAuthorizationCode } from "./codes";
import { OAuthError } from "./errors";
import { assertSupportedResource } from "./resources";
import {
  issueTokens,
  refreshTokens,
  revokeToken,
  type IssuedTokens,
} from "./tokens";

export type OAuthRateScope = "oauth-token" | "oauth-register";

export type OAuthHttpDependencies = {
  /** Database used outside the token transaction (client resolution, DCR, revocation). */
  store?: Queryable;
  /** Injectable transaction so tests can verify the consume + issue pairing. */
  transaction?: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;
  /** Injectable rate limiter; the default reserves one IP-scoped attempt. */
  limit?: (scope: OAuthRateScope, req: Request) => Promise<void>;
  resolve?: (clientId: string, q: Queryable) => Promise<OAuthClient>;
  register?: (input: unknown, q: Queryable) => Promise<RegisterClientResponse>;
  revoke?: (token: string, q: Queryable) => Promise<boolean>;
};

const MAX_BODY_BYTES = 64 * 1024;

const defaultTransaction = <T>(fn: (q: Queryable) => Promise<T>): Promise<T> =>
  withTransaction((q) => fn(q));

async function defaultLimit(scope: OAuthRateScope, req: Request): Promise<void> {
  const ip = verifiedAuthClientIp(req) ?? "unattributed";
  await reserveAuthAttempt(scope, ip, POLICIES[scope]);
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store", pragma: "no-cache" };
}

function tokenJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status, noStoreHeaders());
}

async function readBoundedText(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error("request body is too large");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new Error("request body is too large");
  }
  return text;
}

async function readJson(req: Request): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedText(req);
  } catch {
    throw new OAuthError("invalid_client_metadata", "request body is too large or unreadable");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OAuthError("invalid_client_metadata", "request body must be valid JSON");
  }
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const contentType = req.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new OAuthError(
      "invalid_request",
      "request body must be application/x-www-form-urlencoded",
    );
  }
  let text: string;
  try {
    text = await readBoundedText(req);
  } catch {
    throw new OAuthError("invalid_request", "request body is too large or unreadable");
  }
  return new URLSearchParams(text);
}

function required(form: URLSearchParams, name: string): string {
  const value = form.get(name);
  if (value === null || value === "") {
    throw new OAuthError("invalid_request", `${name} is required`);
  }
  return value;
}

function optionalResource(form: URLSearchParams): string | undefined {
  const resource = form.get("resource");
  if (resource === null) return undefined;
  // The two MCP audiences are the only accepted targets. A mismatch with the
  // authorization code's stored audience is handled after consumption.
  assertSupportedResource(resource);
  return resource;
}

function tokenErrorDescription(error: OAuthError): string {
  switch (error.code) {
    case "invalid_request":
      return error.message;
    case "invalid_client":
      return "client authentication failed";
    case "invalid_grant":
      return "authorization grant is invalid";
    case "invalid_target":
      return "resource is not supported";
    case "unsupported_grant_type":
      return "grant_type is not supported";
    case "access_denied":
      return "access denied";
    case "invalid_scope":
      return "requested scope is invalid";
    case "temporarily_unavailable":
      return "temporarily unavailable";
    default:
      return "token request failed";
  }
}

function tokenErrorResponse(error: unknown): Response {
  if (error instanceof OAuthError) {
    return tokenJson(
      { error: error.code, error_description: tokenErrorDescription(error) },
      error.code === "invalid_client" ? 401 : error.status,
    );
  }
  console.error(
    "[oauth/token] request failed:",
    error instanceof Error ? error.message : String(error),
  );
  return tokenJson({ error: "server_error", error_description: "token request failed" }, 500);
}

function tokenPayload(tokens: IssuedTokens) {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(" "),
  };
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  store: Queryable,
  transaction: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
  resolve: (clientId: string, q: Queryable) => Promise<OAuthClient>,
): Promise<IssuedTokens> {
  const code = required(form, "code");
  const redirectUri = required(form, "redirect_uri");
  const clientId = required(form, "client_id");
  const codeVerifier = required(form, "code_verifier");
  const resource = optionalResource(form);
  const client = await resolve(clientId, store);

  const outcome = await transaction(async (q) => {
    let consumed;
    try {
      consumed = await consumeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
        ...(resource === undefined ? {} : { resource }),
      }, q);
    } catch (error) {
      if (error instanceof OAuthError) return { ok: false as const, error };
      throw error;
    }

    // consumeAuthorizationCode and issueTokens share this one transaction so
    // a code can never be consumed without its token family (and vice versa).
    const issued = await issueTokens({
      userId: consumed.userId,
      workspaceId: consumed.workspaceId,
      clientId: consumed.clientId,
      clientName: client.clientName,
      scopes: consumed.scopes,
      resource: consumed.resource,
      familyId: consumed.familyId,
    }, q);
    return { ok: true as const, value: issued };
  });

  if (!outcome.ok) {
    // The code stores a different (but supported) audience. The token
    // endpoint reports that per RFC 8707 as invalid_target, not invalid_grant.
    if (outcome.error.code === "invalid_grant"
        && outcome.error.message === "resource does not match") {
      throw new OAuthError("invalid_target", "resource does not match");
    }
    throw outcome.error;
  }
  return outcome.value;
}

async function exchangeRefreshToken(
  form: URLSearchParams,
  transaction: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
): Promise<IssuedTokens> {
  const refreshToken = required(form, "refresh_token");
  const clientId = required(form, "client_id");
  const resource = optionalResource(form);

  const outcome = await transaction(async (q) => {
    try {
      const issued = await refreshTokens(refreshToken, clientId, resource, q);
      return { ok: true as const, value: issued };
    } catch (error) {
      if (error instanceof OAuthError) return { ok: false as const, error };
      throw error;
    }
  });

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/**
 * POST /oauth/token (RFC 6749 / 7636 / 8707).
 *
 * The authorization-code exchange runs consumeAuthorizationCode and
 * issueTokens in the same transaction. A replay error is caught inside the
 * transaction so the family revocation written by the service is committed
 * before the error is returned.
 */
export async function handleTokenRequest(
  req: Request,
  options: OAuthHttpDependencies = {},
): Promise<Response> {
  const limit = options.limit ?? defaultLimit;
  try {
    await limit("oauth-token", req);
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) {
      limited.headers.set("Pragma", "no-cache");
      return limited;
    }
    return tokenErrorResponse(error);
  }

  try {
    const form = await readForm(req);
    const grantType = form.get("grant_type");
    if (grantType === null || grantType === "") {
      throw new OAuthError("invalid_request", "grant_type is required");
    }

    const store = options.store ?? db;
    const transaction = options.transaction ?? defaultTransaction;
    let tokens: IssuedTokens;
    if (grantType === "authorization_code") {
      tokens = await exchangeAuthorizationCode(
        form,
        store,
        transaction,
        options.resolve ?? resolveClient,
      );
    } else if (grantType === "refresh_token") {
      tokens = await exchangeRefreshToken(form, transaction);
    } else {
      throw new OAuthError("unsupported_grant_type", "unsupported grant type");
    }
    return tokenJson(tokenPayload(tokens));
  } catch (error) {
    return tokenErrorResponse(error);
  }
}

function registrationError(error: string, description: string, status = 400): Response {
  return jsonResponse(
    { error, error_description: description },
    status,
    { "cache-control": "no-store" },
  );
}

/**
 * POST /oauth/register (RFC 7591). Only validation failures use the RFC's
 * invalid_redirect_uri / invalid_client_metadata codes; anything unexpected
 * is a generic server_error and never exposes storage details.
 */
export async function handleClientRegistration(
  req: Request,
  options: OAuthHttpDependencies = {},
): Promise<Response> {
  const limit = options.limit ?? defaultLimit;
  try {
    await limit("oauth-register", req);
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    console.error(
      "[oauth/register] rate limit failed:",
      error instanceof Error ? error.message : String(error),
    );
    return registrationError("server_error", "client registration failed", 500);
  }

  try {
    const input = await readJson(req);
    const register = options.register ?? registerClient;
    const client = await register(input, options.store ?? db);
    return jsonResponse(client, 201, { "cache-control": "no-store" });
  } catch (error) {
    if (error instanceof OAuthError
        && (error.code === "invalid_redirect_uri" || error.code === "invalid_client_metadata")) {
      return registrationError(error.code, error.message);
    }
    console.error(
      "[oauth/register] request failed:",
      error instanceof Error ? error.message : String(error),
    );
    return registrationError("server_error", "client registration failed", 500);
  }
}

function revocationError(error: unknown): Response {
  if (error instanceof OAuthError) {
    return jsonResponse(
      { error: error.code, error_description: error.message },
      error.status,
      noStoreHeaders(),
    );
  }
  console.error(
    "[oauth/revoke] request failed:",
    error instanceof Error ? error.message : String(error),
  );
  return jsonResponse(
    { error: "server_error", error_description: "revocation failed" },
    500,
    noStoreHeaders(),
  );
}

/**
 * POST /oauth/revoke (RFC 7009). Unknown or already-revoked tokens are
 * indistinguishable from success, so the endpoint answers 200 either way.
 */
export async function handleRevocationRequest(
  req: Request,
  options: OAuthHttpDependencies = {},
): Promise<Response> {
  try {
    const form = await readForm(req);
    const token = form.get("token");
    if (token === null || token === "") {
      throw new OAuthError("invalid_request", "token is required");
    }
    const clientId = form.get("client_id");
    if (clientId === null || clientId === "") {
      throw new OAuthError("invalid_request", "client_id is required");
    }
    const revoke = options.revoke ?? revokeToken;
    await revoke(token, options.store ?? db);
  } catch (error) {
    return revocationError(error);
  }
  return new Response(null, { status: 200, headers: noStoreHeaders() });
}
