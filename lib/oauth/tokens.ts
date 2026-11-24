import { randomBytes, randomUUID } from "node:crypto";
import { db, withTransaction, type Queryable } from "@/lib/db";
import { hashMcpToken } from "@/lib/mcp/token";
import { OAuthError } from "./errors";
import { lockOAuthFamily } from "./family-lock";
import { assertSupportedResource } from "./resources";
import { normalizeOAuthScopes, type OAuthScope } from "./scopes";

export const OAUTH_ACCESS_TOKEN_PREFIX = "atlas_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "atlas_ort_";
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function generateOAuthAccessToken(): string {
  return `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function generateOAuthRefreshToken(): string {
  return `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isOAuthAccessToken(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
    && TOKEN_BODY.test(value.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));
}

export function isOAuthRefreshToken(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)
    && TOKEN_BODY.test(value.slice(OAUTH_REFRESH_TOKEN_PREFIX.length));
}

export type IssueTokensInput = {
  userId: number;
  workspaceId: number;
  clientId: string;
  clientName?: string | null;
  scopes: unknown;
  resource: string;
  /** Set for a refresh rotation or a code exchange so related tokens share a family. */
  familyId?: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshExpiresIn: number;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  scopes: OAuthScope[];
  resource: string;
  familyId: string;
  accessTokenId: number;
  refreshTokenId: number;
};

type PrincipalRow = {
  id: number;
  deactivated_at: Date | string | null;
  is_guest: boolean | null;
  mcp_enabled: boolean | null;
};

type RefreshRow = {
  id: number;
  family_id: string;
  client_id: string;
  user_id: number;
  workspace_id: number;
  scopes: string[] | null;
  resource: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  client_name: string | null;
  client_revoked_at?: Date | string | null;
};

function accessDenied(message: string): OAuthError {
  return new OAuthError("access_denied", message);
}

function invalidGrant(message: string): OAuthError {
  return new OAuthError("invalid_grant", message);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isExpired(value: Date | string, now = Date.now()): boolean {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) || time <= now;
}

function tokenName(clientName: string | null | undefined): string {
  const name = typeof clientName === "string" ? clientName.trim() : "";
  return name === "" ? "OAuth client" : name.slice(0, 200);
}

/**
 * Re-check the token owner and workspace on every issue and refresh. A guest,
 * a deactivated (or deleted) user, and a workspace with MCP disabled all fail
 * closed. `mcp_pat_enabled` deliberately does not apply to OAuth.
 */
async function requireTokenPrincipal(
  q: Queryable,
  userId: number,
  workspaceId: number,
): Promise<void> {
  const result = await q.query(
    `SELECT u.id, u.deactivated_at, u.is_guest,
       COALESCE(w.mcp_enabled, false) AS mcp_enabled
     FROM users u
     LEFT JOIN workspace_security w ON w.workspace_id = $2
     WHERE u.id = $1
     FOR UPDATE OF u`,
    [userId, workspaceId],
  );
  const row = result.rows[0] as PrincipalRow | undefined;
  if (!row || row.deactivated_at !== null && row.deactivated_at !== undefined) {
    throw accessDenied("unknown or inactive user");
  }
  if (row.is_guest === true) throw accessDenied("guest users cannot use MCP");
  if (row.mcp_enabled !== true) throw accessDenied("MCP is disabled");
}

async function insertTokenPair(
  q: Queryable,
  input: {
    userId: number;
    workspaceId: number;
    clientId: string;
    clientName: string | null;
    scopes: OAuthScope[];
    resource: string;
    familyId: string;
  },
): Promise<IssuedTokens> {
  const accessToken = generateOAuthAccessToken();
  const refreshToken = generateOAuthRefreshToken();
  const accessInserted = await q.query(
    `INSERT INTO mcp_tokens
       (workspace_id, user_id, kind, name, token_hash, scopes, client_name,
        expires_at, resource, oauth_client_id, oauth_family_id)
     VALUES ($1, $2, 'oauth', $3, $4, $5, $6,
        now() + interval '24 hours', $7, $8, $9::uuid)
     RETURNING id, expires_at::text AS expires_at`,
    [
      input.workspaceId,
      input.userId,
      tokenName(input.clientName),
      hashMcpToken(accessToken),
      input.scopes,
      input.clientName,
      input.resource,
      input.clientId,
      input.familyId,
    ],
  );
  const accessRow = accessInserted.rows[0] as
    | { id: number; expires_at: string }
    | undefined;
  if (!accessRow) throw new Error("failed to create OAuth access token");

  const refreshInserted = await q.query(
    `INSERT INTO oauth_refresh_tokens
       (token_hash, family_id, client_id, user_id, workspace_id, scopes, resource, expires_at)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, now() + interval '30 days')
     RETURNING id, expires_at::text AS expires_at`,
    [
      hashMcpToken(refreshToken),
      input.familyId,
      input.clientId,
      input.userId,
      input.workspaceId,
      input.scopes,
      input.resource,
    ],
  );
  const refreshRow = refreshInserted.rows[0] as
    | { id: number; expires_at: string }
    | undefined;
  if (!refreshRow) throw new Error("failed to create OAuth refresh token");

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    accessTokenExpiresAt: accessRow.expires_at,
    refreshTokenExpiresAt: refreshRow.expires_at,
    scopes: input.scopes,
    resource: input.resource,
    familyId: input.familyId,
    accessTokenId: Number(accessRow.id),
    refreshTokenId: Number(refreshRow.id),
  };
}

async function revokeFamily(q: Queryable, familyId: string): Promise<void> {
  // Rotation inserts new rows into the same family, so serialize with it:
  // these UPDATEs alone would not see rows committed after their snapshot.
  // Re-entrant when refreshTokensInTransaction already holds the lock.
  await lockOAuthFamily(q, familyId);
  // Keep the same table order as revokeAllUserTokens (access rows first) so
  // concurrent deactivation and family revocation cannot deadlock.
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
 * Issue an access token (24h) and a refresh token (30d). Both rows store only
 * SHA-256 hashes; the plaintext values are returned once. The caller's user
 * and workspace are re-checked before the insert.
 */
export async function issueTokens(
  input: IssueTokensInput,
  q: Queryable = db,
): Promise<IssuedTokens> {
  if (q === db) return withTransaction((tx) => issueTokens(input, tx));

  if (!positiveInteger(input.userId) || !positiveInteger(input.workspaceId)) {
    throw new OAuthError("invalid_request", "user and workspace are required");
  }
  if (typeof input.clientId !== "string" || input.clientId === "") {
    throw new OAuthError("invalid_request", "client_id is required");
  }
  const scopes = normalizeOAuthScopes(input.scopes);
  if (!scopes) throw new OAuthError("invalid_scope", "scopes must include read and only read/write");
  const resource = assertSupportedResource(input.resource);
  const familyId = input.familyId ?? randomUUID();
  if (!UUID_FORMAT.test(familyId)) {
    throw new OAuthError("invalid_request", "family_id must be a UUID");
  }

  await requireTokenPrincipal(q, input.userId, input.workspaceId);
  return insertTokenPair(q, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    clientName: input.clientName ?? null,
    scopes,
    resource,
    familyId,
  });
}

/**
 * Rotate a refresh token. The presented token must be unused, unrevoked,
 * unexpired and belong to `clientId`. A replayed (used) token revokes the
 * whole family. `resource`, when supplied, must equal the original audience.
 *
 * Replay revocation is written before the error escapes the transaction.
 * Callers that pass their own Queryable transaction must commit (not roll
 * back) before propagating the replay error.
 */
export async function refreshTokens(
  refreshToken: string,
  clientId: string,
  resource?: string,
  q: Queryable = db,
): Promise<IssuedTokens> {
  const result = q === db
    ? await withTransaction((tx) => refreshTokensInTransaction(refreshToken, clientId, resource, tx))
    : await refreshTokensInTransaction(refreshToken, clientId, resource, q);
  if ("oauthError" in result) throw result.oauthError;
  return result;
}

type RefreshRejection = { oauthError: OAuthError };

async function refreshTokensInTransaction(
  refreshToken: string,
  clientId: string,
  resource: string | undefined,
  q: Queryable,
): Promise<IssuedTokens | RefreshRejection> {
  if (!isOAuthRefreshToken(refreshToken)) throw invalidGrant("refresh token is invalid");
  if (typeof clientId !== "string" || clientId === "") throw invalidGrant("client_id is required");
  const hash = hashMcpToken(refreshToken);

  const found = await q.query(
    `SELECT id, user_id, workspace_id, family_id::text AS family_id
     FROM oauth_refresh_tokens
     WHERE token_hash = $1`,
    [hash],
  );
  const foundRow = found.rows[0] as
    | { id: number; user_id: number; workspace_id: number; family_id: string }
    | undefined;
  if (!foundRow) throw invalidGrant("refresh token is invalid");

  // Lock order: user row -> family advisory lock -> token row. The family
  // lock keeps a concurrent revocation from missing the pair inserted below
  // by this rotation.
  await requireTokenPrincipal(q, Number(foundRow.user_id), Number(foundRow.workspace_id));
  await lockOAuthFamily(q, String(foundRow.family_id));

  const selected = await q.query(
    `SELECT rt.id, rt.family_id::text AS family_id, rt.client_id, rt.user_id,
       rt.workspace_id, rt.scopes, rt.resource, rt.expires_at, rt.used_at,
       rt.revoked_at, c.client_name, c.revoked_at AS client_revoked_at
     FROM oauth_refresh_tokens rt
     LEFT JOIN oauth_clients c ON c.client_id = rt.client_id
     WHERE rt.id = $1
     FOR UPDATE OF rt`,
    [foundRow.id],
  );
  const row = selected.rows[0] as RefreshRow | undefined;
  if (!row) throw invalidGrant("refresh token is invalid");

  if (row.used_at !== null && row.used_at !== undefined) {
    await revokeFamily(q, row.family_id);
    return { oauthError: invalidGrant("refresh token reuse detected") };
  }
  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    throw invalidGrant("refresh token has been revoked");
  }
  if (row.client_revoked_at !== null && row.client_revoked_at !== undefined) {
    throw invalidGrant("client has been revoked");
  }
  if (row.client_id !== clientId) {
    throw invalidGrant("refresh token was issued to another client");
  }
  if (isExpired(row.expires_at)) throw invalidGrant("refresh token has expired");
  if (resource !== undefined && resource !== row.resource) {
    throw new OAuthError("invalid_target", "resource does not match the refresh token");
  }
  const scopes = normalizeOAuthScopes(row.scopes);
  if (!scopes) throw invalidGrant("refresh token has invalid scopes");

  const marked = await q.query(
    `UPDATE oauth_refresh_tokens SET used_at = now()
     WHERE id = $1 AND used_at IS NULL`,
    [row.id],
  );
  if (marked.rowCount === 0) {
    await revokeFamily(q, row.family_id);
    return { oauthError: invalidGrant("refresh token reuse detected") };
  }

  return insertTokenPair(q, {
    userId: Number(row.user_id),
    workspaceId: Number(row.workspace_id),
    clientId: row.client_id,
    clientName: row.client_name,
    scopes,
    resource: row.resource,
    familyId: row.family_id,
  });
}

/**
 * RFC 7009 revocation. Either an access token or a refresh token is accepted
 * and the whole family is revoked. Unknown or malformed values are ignored
 * (the endpoint must still answer 200); the boolean is for tests and audit.
 */
export async function revokeToken(token: string, q: Queryable = db): Promise<boolean> {
  if (q === db) return withTransaction((tx) => revokeToken(token, tx));

  const hash = hashMcpToken(token);
  if (isOAuthAccessToken(token)) {
    const found = await q.query(
      `SELECT id, oauth_family_id::text AS oauth_family_id
       FROM mcp_tokens
       WHERE token_hash = $1 AND kind = 'oauth'`,
      [hash],
    );
    const row = found.rows[0] as { id: number; oauth_family_id: string | null } | undefined;
    if (!row) return false;
    if (row.oauth_family_id) {
      await revokeFamily(q, row.oauth_family_id);
    } else {
      await q.query(
        `UPDATE mcp_tokens SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [row.id],
      );
    }
    return true;
  }
  if (isOAuthRefreshToken(token)) {
    const found = await q.query(
      `SELECT family_id::text AS family_id
       FROM oauth_refresh_tokens
       WHERE token_hash = $1`,
      [hash],
    );
    const row = found.rows[0] as { family_id: string } | undefined;
    if (!row) return false;
    await revokeFamily(q, row.family_id);
    return true;
  }
  return false;
}
