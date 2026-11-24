import { randomBytes, randomUUID } from "node:crypto";
import { db, withTransaction, type Queryable } from "@/lib/db";
import { hashMcpToken } from "@/lib/mcp/token";
import { OAuthError } from "./errors";
import { lockOAuthFamily } from "./family-lock";
import { isValidCodeChallenge, verifyPkce } from "./pkce";
import { isAllowedRedirectUri } from "./redirect";
import { assertSupportedResource } from "./resources";
import { normalizeOAuthScopes, type OAuthScope } from "./scopes";

export const AUTHORIZATION_CODE_PREFIX = "atlas_oac_";
const CODE_BODY = /^[A-Za-z0-9_-]{43}$/;

export function isAuthorizationCode(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith(AUTHORIZATION_CODE_PREFIX)
    && CODE_BODY.test(value.slice(AUTHORIZATION_CODE_PREFIX.length));
}

export type IssueAuthorizationCodeInput = {
  clientId: string;
  userId: number;
  workspaceId: number;
  redirectUri: string;
  codeChallenge: string;
  /** The authorization request's method; omitted means S256 (the only allowed value). */
  codeChallengeMethod?: string;
  scopes: unknown;
  resource: string;
};

export type IssuedAuthorizationCode = {
  code: string;
  familyId: string;
  expiresAt: string;
};

export type ConsumeAuthorizationCodeInput = {
  code: string;
  clientId: string;
  redirectUri: string;
  /** Optional at the token endpoint; the code's stored audience is used if omitted. */
  resource?: string;
  codeVerifier: string;
  /** Only S256 is accepted; the token endpoint normally omits this. */
  codeChallengeMethod?: string;
};

export type ConsumedAuthorizationCode = {
  clientId: string;
  userId: number;
  workspaceId: number;
  redirectUri: string;
  scopes: OAuthScope[];
  resource: string;
  familyId: string;
};

type CodeRow = {
  id: number;
  code_hash: string;
  client_id: string;
  user_id: number;
  workspace_id: number;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[] | null;
  resource: string;
  family_id: string;
  expires_at: Date | string;
  used_at: Date | string | null;
};

function invalidGrant(message: string): OAuthError {
  return new OAuthError("invalid_grant", message);
}

function isExpired(value: Date | string, now = Date.now()): boolean {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) || time <= now;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function revokeCodeFamily(q: Queryable, familyId: string): Promise<void> {
  // Same lock order and rotation-race protection as tokens.revokeFamily.
  await lockOAuthFamily(q, familyId);
  // Same order as revokeFamily / revokeAllUserTokens.
  await q.query(
    `UPDATE mcp_tokens SET revoked_at = now()
     WHERE oauth_family_id = $1::uuid AND revoked_at IS NULL`,
    [familyId],
  );
  await q.query(
    `UPDATE oauth_refresh_tokens SET revoked_at = now()
     WHERE family_id = $1::uuid AND revoked_at IS NULL`,
    [familyId],
  );
}

/**
 * Persist a new authorization code. The plaintext is returned once; only its
 * SHA-256 hash is stored. The code is valid for 10 minutes and carries a
 * family id that the token exchange must reuse for its refresh-token family.
 */
export async function issueAuthorizationCode(
  input: IssueAuthorizationCodeInput,
  q: Queryable = db,
): Promise<IssuedAuthorizationCode> {
  if (q === db) return withTransaction((tx) => issueAuthorizationCode(input, tx));

  if (typeof input.clientId !== "string" || input.clientId === "") {
    throw new OAuthError("invalid_request", "client_id is required");
  }
  if (!positiveInteger(input.userId) || !positiveInteger(input.workspaceId)) {
    throw new OAuthError("invalid_request", "user and workspace are required");
  }
  if (typeof input.redirectUri !== "string" || !isAllowedRedirectUri(input.redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri is invalid");
  }
  if (!isValidCodeChallenge(input.codeChallenge)) {
    throw new OAuthError("invalid_request", "code_challenge must be an S256 challenge");
  }
  if ((input.codeChallengeMethod ?? "S256") !== "S256") {
    throw new OAuthError("invalid_request", "code_challenge_method must be S256");
  }
  const scopes = normalizeOAuthScopes(input.scopes);
  if (!scopes) throw new OAuthError("invalid_scope", "scopes must include read and only read/write");
  const resource = assertSupportedResource(input.resource);

  const code = `${AUTHORIZATION_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
  const familyId = randomUUID();
  const inserted = await q.query(
    `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, workspace_id, redirect_uri, code_challenge,
        scopes, resource, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, now() + interval '10 minutes')
     RETURNING expires_at::text AS expires_at`,
    [
      hashMcpToken(code),
      input.clientId,
      input.userId,
      input.workspaceId,
      input.redirectUri,
      input.codeChallenge,
      scopes,
      resource,
      familyId,
    ],
  );
  const row = inserted.rows[0] as { expires_at: string } | undefined;
  if (!row) throw new Error("failed to create authorization code");
  return { code, familyId, expiresAt: row.expires_at };
}

/**
 * Consume an authorization code exactly once.
 *
 * The code, client, redirect_uri and resource must match the issued values,
 * the code must be unexpired and the PKCE verifier must hash to the stored
 * S256 challenge. A second use revokes every refresh token and access token
 * in the family created from this code.
 *
 * Replay revocation is written before the error escapes the transaction, so
 * the family stays revoked. Callers that pass their own Queryable transaction
 * must commit (not roll back) before propagating the replay error.
 */
export async function consumeAuthorizationCode(
  input: ConsumeAuthorizationCodeInput,
  q: Queryable = db,
): Promise<ConsumedAuthorizationCode> {
  const result = q === db
    ? await withTransaction((tx) => consumeAuthorizationCodeInTransaction(input, tx))
    : await consumeAuthorizationCodeInTransaction(input, q);
  if ("oauthError" in result) throw result.oauthError;
  return result;
}

type ConsumeRejection = { oauthError: OAuthError };

async function consumeAuthorizationCodeInTransaction(
  input: ConsumeAuthorizationCodeInput,
  q: Queryable,
): Promise<ConsumedAuthorizationCode | ConsumeRejection> {
  if (!isAuthorizationCode(input.code)) throw invalidGrant("authorization code is invalid");
  const hash = hashMcpToken(input.code);

  // Read the owner without a row lock, then lock in the same order as the
  // refresh flow: users row -> family -> code row. revokeAllUserTokens holds
  // the user row before deleting unused codes, so taking the code row first
  // here would invert the order and deadlock.
  const owner = await q.query(
    `SELECT user_id, family_id::text AS family_id
     FROM oauth_authorization_codes
     WHERE code_hash = $1`,
    [hash],
  );
  const ownerRow = owner.rows[0] as
    | { user_id: number; family_id: string }
    | undefined;
  if (!ownerRow) throw invalidGrant("authorization code is invalid");

  const lockedUser = await q.query(
    "SELECT id FROM users WHERE id = $1::bigint FOR UPDATE",
    [Number(ownerRow.user_id)],
  );
  if (!lockedUser.rowCount) throw invalidGrant("authorization code is invalid");

  await lockOAuthFamily(q, String(ownerRow.family_id));

  const selected = await q.query(
    `SELECT id, code_hash, client_id, user_id, workspace_id, redirect_uri,
       code_challenge, scopes, resource, family_id::text AS family_id,
       expires_at, used_at
     FROM oauth_authorization_codes
     WHERE code_hash = $1
     FOR UPDATE`,
    [hash],
  );
  const row = selected.rows[0] as CodeRow | undefined;
  if (!row) throw invalidGrant("authorization code is invalid");

  if (row.used_at !== null && row.used_at !== undefined) {
    await revokeCodeFamily(q, row.family_id);
    return { oauthError: invalidGrant("authorization code has already been used") };
  }
  if (isExpired(row.expires_at)) throw invalidGrant("authorization code has expired");
  if (row.client_id !== input.clientId) throw invalidGrant("authorization code was issued to another client");
  if (row.redirect_uri !== input.redirectUri) throw invalidGrant("redirect_uri does not match");
  if (input.resource !== undefined && row.resource !== input.resource) {
    throw invalidGrant("resource does not match");
  }
  if (!verifyPkce(input.codeVerifier, row.code_challenge, input.codeChallengeMethod ?? "S256")) {
    throw invalidGrant("PKCE verification failed");
  }
  const scopes = normalizeOAuthScopes(row.scopes);
  if (!scopes) throw invalidGrant("authorization code has invalid scopes");

  const used = await q.query(
    `UPDATE oauth_authorization_codes SET used_at = now()
     WHERE id = $1 AND used_at IS NULL`,
    [row.id],
  );
  if (used.rowCount === 0) {
    await revokeCodeFamily(q, row.family_id);
    return { oauthError: invalidGrant("authorization code has already been used") };
  }

  return {
    clientId: row.client_id,
    userId: Number(row.user_id),
    workspaceId: Number(row.workspace_id),
    redirectUri: row.redirect_uri,
    scopes,
    resource: row.resource,
    familyId: row.family_id,
  };
}
