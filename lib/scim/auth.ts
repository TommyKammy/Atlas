import { db, type Queryable } from "@/lib/db";
import { POLICIES, reserveAuthAttempt } from "@/lib/auth-rate-limit";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import {
  bearerToken, hashScimToken, isScimToken, scimTokenMatchesHash, shouldTouchLastUsed,
} from "./token";

export type ScimIdp = "entra" | "okta" | "generic";

export type ScimAuthContext = {
  tokenId: number;
  workspaceId: number;
  idp: ScimIdp;
};

type TokenRow = {
  id: number;
  workspace_id: number;
  idp: ScimIdp;
  token_hash: string;
  scim_enabled: boolean;
  last_used_at: Date | null;
};

/**
 * Failure-only admission: successful provisioning traffic (Entra regularly
 * sends bursts) never consumes the per-IP budget.
 */
async function recordAuthenticationFailure(req: Request, store: Queryable) {
  const ip = verifiedAuthClientIp(req) ?? "unattributed";
  await reserveAuthAttempt("scim-auth", ip, POLICIES["scim-auth"], store);
}

/** Resolve a bearer token to its workspace and IdP, or null for any failure. */
export async function authenticateScim(req: Request, store: Queryable = db): Promise<ScimAuthContext | null> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token || !isScimToken(token)) {
    await recordAuthenticationFailure(req, store);
    return null;
  }
  const hash = hashScimToken(token);
  const result = await store.query(
    `SELECT t.id, t.workspace_id, t.idp, t.token_hash, t.last_used_at,
       COALESCE(w.scim_enabled, false) AS scim_enabled
     FROM scim_tokens t
     LEFT JOIN workspace_security w ON w.workspace_id = t.workspace_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hash],
  );
  const row = result.rows[0] as TokenRow | undefined;
  if (!row || !row.scim_enabled || !scimTokenMatchesHash(row.token_hash, hash)) {
    await recordAuthenticationFailure(req, store);
    return null;
  }
  if (shouldTouchLastUsed(row.last_used_at)) {
    // Advisory only. The timestamp moves at most once a minute per token.
    await store.query(
      `UPDATE scim_tokens SET last_used_at = now() WHERE id = $1
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
      [row.id],
    ).catch(() => undefined);
  }
  return { tokenId: Number(row.id), workspaceId: Number(row.workspace_id), idp: row.idp };
}
