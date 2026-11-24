import { db, type Queryable } from "@/lib/db";
import { POLICIES, reserveAuthAttempt } from "@/lib/auth-rate-limit";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import { isOAuthAccessToken } from "@/lib/oauth/tokens";
import { resourceMatchesEndpoint } from "@/lib/oauth/resources";
import type { Actor } from "@/lib/services/actor";
import {
  bearerToken, hashMcpToken, isMcpToken, mcpTokenMatchesHash, shouldTouchLastUsed,
} from "./token";

export type McpScope = "read" | "write";
export type McpEndpoint = "default" | "readonly";
export type McpTokenKind = "pat" | "oauth";

export type McpAuthFailureReason =
  | "invalid"
  | "disabled"
  | "inactive_user"
  | "guest"
  | "expired"
  | "revoked"
  | "audience";

export type McpAuthSuccess = {
  ok: true;
  tokenId: number;
  workspaceId: number;
  userId: number;
  kind: McpTokenKind;
  scopes: McpScope[];
  clientName: string | null;
  actor: Actor;
};

export type McpAuthFailure = { ok: false; reason: McpAuthFailureReason };

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

type TokenRow = {
  id: number;
  workspace_id: number;
  user_id: number;
  kind: McpTokenKind;
  token_hash: string;
  scopes: string[] | null;
  client_name: string | null;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  resource: string | null;
  mcp_enabled: boolean | null;
  mcp_pat_enabled: boolean | null;
  user_exists: boolean | null;
  deactivated_at: Date | string | null;
  is_guest: boolean | null;
};

const SCOPES: McpScope[] = ["read", "write"];

/**
 * Failure-only admission: a successful MCP request never consumes the
 * per-IP authentication budget.
 */
async function recordAuthenticationFailure(req: Request, store: Queryable) {
  const ip = verifiedAuthClientIp(req) ?? "unattributed";
  await reserveAuthAttempt("mcp-auth", ip, POLICIES["mcp-auth"], store);
}

function normalizeScopes(value: string[] | null): McpScope[] | null {
  if (!Array.isArray(value) || !value.includes("read")) return null;
  if (!value.every((scope) => scope === "read" || scope === "write")) return null;
  return SCOPES.filter((scope) => value.includes(scope));
}

function isExpired(row: TokenRow, now = Date.now()): boolean {
  // A PAT is valid until it is revoked; OAuth access tokens must carry a
  // future expiry (fail closed if one is missing).
  if (row.kind !== "oauth") return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const value = row.expires_at instanceof Date
    ? row.expires_at.getTime()
    : new Date(row.expires_at).getTime();
  return Number.isNaN(value) || value <= now;
}

/**
 * Resolve an MCP bearer token to its workspace, user and effective scopes.
 * Every call re-reads the token, workspace flags, and the live user state so a
 * disabled workspace, deactivation or guest role change takes effect at once.
 */
export async function authenticateMcpToken(
  req: Request,
  opts: { endpoint: McpEndpoint },
  q: Queryable = db,
): Promise<McpAuthResult> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token || (!isMcpToken(token) && !isOAuthAccessToken(token))) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "invalid" };
  }
  const hash = hashMcpToken(token);
  const result = await q.query(
    `SELECT t.id, t.workspace_id, t.user_id, t.kind, t.token_hash, t.scopes,
       t.client_name, t.expires_at, t.revoked_at, t.last_used_at, t.resource,
       COALESCE(w.mcp_enabled, false) AS mcp_enabled,
       COALESCE(w.mcp_pat_enabled, false) AS mcp_pat_enabled,
       (u.id IS NOT NULL) AS user_exists,
       u.deactivated_at,
       COALESCE(u.is_guest, false) AS is_guest
     FROM mcp_tokens t
     LEFT JOIN workspace_security w ON w.workspace_id = t.workspace_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [hash],
  );
  const row = result.rows[0] as TokenRow | undefined;
  if (!row || !mcpTokenMatchesHash(row.token_hash, hash)) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "invalid" };
  }
  if (row.kind !== "pat" && row.kind !== "oauth") {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "invalid" };
  }
  const scopes = normalizeScopes(row.scopes);
  if (!scopes) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "invalid" };
  }
  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "revoked" };
  }
  if (isExpired(row)) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "expired" };
  }
  // OAuth access tokens are audience-bound to one MCP endpoint. PATs have no
  // resource and keep their previous behaviour.
  if (row.kind === "oauth" && !resourceMatchesEndpoint(row.resource, opts.endpoint)) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "audience" };
  }
  if (row.mcp_enabled !== true || (row.kind === "pat" && row.mcp_pat_enabled !== true)) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "disabled" };
  }
  if (row.user_exists !== true || (row.deactivated_at !== null && row.deactivated_at !== undefined)) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "inactive_user" };
  }
  if (row.is_guest === true) {
    await recordAuthenticationFailure(req, q);
    return { ok: false, reason: "guest" };
  }

  const tokenId = Number(row.id);
  const userId = Number(row.user_id);
  const clientName = typeof row.client_name === "string" && row.client_name !== ""
    ? row.client_name
    : null;
  if (shouldTouchLastUsed(row.last_used_at)) {
    // Advisory only. The timestamp moves at most once a minute per token.
    await q.query(
      `UPDATE mcp_tokens SET last_used_at = now() WHERE id = $1
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
      [row.id],
    ).catch(() => undefined);
  }
  const actor: Actor = { uid: userId, source: "mcp", tokenId };
  if (clientName) actor.clientName = clientName;
  return {
    ok: true,
    tokenId,
    workspaceId: Number(row.workspace_id),
    userId,
    kind: row.kind,
    // The readonly endpoint never exposes write, even when the token has it.
    scopes: opts.endpoint === "readonly" ? ["read"] : scopes,
    clientName,
    actor,
  };
}
