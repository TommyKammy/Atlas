import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../api/errors";
import { db, type Queryable } from "../db";
import { generateMcpToken, hashMcpToken } from "../mcp/token";
import type { McpScope } from "../mcp/auth";
import { requireNotGuest, type Actor } from "./actor";

export type PersonalTokenAccess = "read" | "read_write";

export type CreatedPersonalToken = {
  id: number;
  /** Plaintext. Returned only from createPersonalToken and never stored. */
  token: string;
  name: string;
  scopes: McpScope[];
  created_at: string;
};

export type PersonalTokenSummary = {
  id: number;
  name: string;
  scopes: McpScope[];
  client_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type WorkspaceMcpSettings = {
  workspace_id: number;
  mcp_enabled: boolean;
  mcp_pat_enabled: boolean;
};

const NAME_MAX_LENGTH = 100;

function tokenScopes(access: PersonalTokenAccess): McpScope[] {
  return access === "read_write" ? ["read", "write"] : ["read"];
}

/**
 * Issue a personal access token for the actor. Guests cannot issue tokens and
 * both workspace switches must be on. The plaintext leaves this function once;
 * only its SHA-256 hash is persisted.
 */
export async function createPersonalToken(
  actor: Actor,
  input: { name?: unknown; access?: unknown },
): Promise<CreatedPersonalToken> {
  await requireNotGuest(actor);
  const settings = await db.query(
    `SELECT workspace_id, mcp_enabled, mcp_pat_enabled
     FROM workspace_security ORDER BY workspace_id LIMIT 1`,
  );
  const workspace = settings.rows[0] as WorkspaceMcpSettings | undefined;
  if (!workspace || workspace.mcp_enabled !== true || workspace.mcp_pat_enabled !== true) {
    throw forbidden("MCP personal access tokens are disabled");
  }
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name === "") throw badRequest("name is required");
  if (name.length > NAME_MAX_LENGTH) {
    throw badRequest(`name must be ${NAME_MAX_LENGTH} characters or fewer`);
  }
  const access = input?.access;
  if (access !== "read" && access !== "read_write") {
    throw badRequest("access must be read or read_write");
  }
  const token = generateMcpToken();
  const inserted = await db.query(
    `INSERT INTO mcp_tokens (workspace_id, user_id, kind, name, token_hash, scopes)
     VALUES ($1, $2, 'pat', $3, $4, $5)
     RETURNING id, name, scopes, created_at::text AS created_at`,
    [Number(workspace.workspace_id), actor.uid, name, hashMcpToken(token), tokenScopes(access)],
  );
  const row = inserted.rows[0] as
    | { id: number; name: string; scopes: McpScope[]; created_at: string }
    | undefined;
  if (!row) throw new Error("failed to create MCP token");
  await audit(actor.uid, "mcp.token.create", {
    entity: "mcp_token",
    entityId: Number(row.id),
    workspaceId: Number(workspace.workspace_id),
    summary: `MCP パーソナルアクセストークンを発行: ${row.name}`,
  });
  return {
    id: Number(row.id),
    token,
    name: row.name,
    scopes: row.scopes,
    created_at: row.created_at,
  };
}

/** List the actor's PATs. Hashes and plaintext values are never selected. */
export async function listPersonalTokens(actor: Actor): Promise<PersonalTokenSummary[]> {
  const result = await db.query(
    `SELECT id, name, scopes, client_name,
       created_at::text AS created_at,
       last_used_at::text AS last_used_at,
       revoked_at::text AS revoked_at
     FROM mcp_tokens
     WHERE user_id = $1 AND kind = 'pat'
     ORDER BY id DESC`,
    [actor.uid],
  );
  return result.rows as PersonalTokenSummary[];
}

/** Revoke one of the actor's PATs. Another user's token is indistinguishable from a missing one. */
export async function revokePersonalToken(actor: Actor, tokenId: number): Promise<{ id: number }> {
  if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw notFound("token not found");
  const updated = await db.query(
    `UPDATE mcp_tokens SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND kind = 'pat' AND revoked_at IS NULL
     RETURNING id`,
    [tokenId, actor.uid],
  );
  if (updated.rowCount === 0) {
    const existing = await db.query(
      "SELECT id FROM mcp_tokens WHERE id = $1 AND user_id = $2 AND kind = 'pat'",
      [tokenId, actor.uid],
    );
    if (!existing.rowCount) throw notFound("token not found");
    // Already revoked: keep DELETE idempotent for retries.
    return { id: tokenId };
  }
  await audit(actor.uid, "mcp.token.revoke", {
    entity: "mcp_token",
    entityId: tokenId,
    summary: "MCP パーソナルアクセストークンを失効",
  });
  return { id: tokenId };
}

/**
 * Revoke every MCP token (PAT and OAuth) for a user. Deactivation and a change
 * to the guest role call this inside their own transaction.
 */
export async function revokeAllUserTokens(userId: number, q: Queryable = db): Promise<number> {
  const result = await q.query(
    "UPDATE mcp_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return result.rowCount ?? 0;
}
