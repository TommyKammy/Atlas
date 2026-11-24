import { audit } from "../audit";
import { notFound } from "../api/errors";
import { db, withTransaction, type Queryable } from "../db";
import type { McpEndpoint, McpScope } from "../mcp/auth";
import type { McpRequestOutcome } from "../mcp/request-log";
import { lockOAuthFamily } from "../oauth/family-lock";

const FAMILY_ID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MCP_LOG_PAGE_SIZE = 50;

export const MCP_LOG_OUTCOMES = [
  "all",
  "ok",
  "error",
  "denied",
  "unauthenticated",
] as const;

export type McpLogOutcomeFilter = (typeof MCP_LOG_OUTCOMES)[number];

export function isMcpLogOutcomeFilter(value: string): value is McpLogOutcomeFilter {
  return (MCP_LOG_OUTCOMES as readonly string[]).includes(value);
}

type AdminTokenBase = {
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  scopes: McpScope[];
  read_only: boolean;
  last_used_at: string | null;
};

export type AdminPersonalToken = AdminTokenBase & {
  kind: "pat";
  id: number;
  name: string;
  created_at: string;
};

export type AdminOAuthToken = AdminTokenBase & {
  kind: "oauth";
  family_id: string;
  client_name: string;
  endpoint: McpEndpoint;
  first_authorized_at: string;
};

export type AdminMcpToken = AdminPersonalToken | AdminOAuthToken;

export type AdminMcpLog = {
  id: number;
  token_id: number | null;
  token_name: string | null;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  endpoint: McpEndpoint;
  rpc_method: string | null;
  tool_name: string | null;
  outcome: McpRequestOutcome;
  error_code: string | null;
  duration_ms: number;
  client_name: string | null;
  client_ip: string | null;
  created_at: string;
};

type PatRow = {
  id: number;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  name: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
};

type OAuthRow = {
  family_id: string;
  client_id: string | null;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  client_name: string | null;
  resource: string | null;
  scopes: string[] | null;
  first_authorized_at: string;
  last_used_at: string | null;
};

type RevokedPatRow = {
  id: number;
  name: string;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
};

type OAuthOwnerRow = {
  user_id: number;
  client_name: string | null;
  user_name: string | null;
  user_email: string | null;
};

function scopesOf(value: unknown): McpScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is McpScope => scope === "read" || scope === "write");
}

function clientHost(clientId: string | null): string | null {
  if (!clientId) return null;
  try {
    const url = new URL(clientId);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function endpointFromResource(resource: string | null): McpEndpoint {
  if (!resource) return "default";
  try {
    return new URL(resource).pathname.endsWith("/mcp/readonly") ? "readonly" : "default";
  } catch {
    return "default";
  }
}

function displayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function clientLabel(row: Pick<OAuthRow, "client_name" | "client_id">): string {
  return displayName(row.client_name)
    ?? clientHost(row.client_id)
    ?? "動的に登録されたアプリ";
}

function targetLabel(row: {
  user_id: number;
  user_name: string | null;
  user_email: string | null;
}): string {
  return displayName(row.user_name)
    ?? displayName(row.user_email)
    ?? `ユーザー #${row.user_id}`;
}

function lastUsedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Lock the acting administrator and the credential owner together, in ascending
 * id order. Admin user management locks the same pair the same way before
 * revoking tokens, and the audit INSERT needs a foreign-key share lock on the
 * actor row. Taking only the owner here could deadlock with a password/2FA
 * reset or deactivation of that owner.
 */
async function lockAdminAndOwner(
  q: Queryable,
  actorId: number,
  ownerId: number,
): Promise<number[]> {
  const ids = actorId === ownerId ? [ownerId] : [actorId, ownerId].sort((a, b) => a - b);
  const locked = await q.query(
    "SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
    [ids],
  );
  return (locked.rows as { id: number | string }[]).map((row) => Number(row.id));
}

/**
 * Active MCP credentials for the workspace: PATs stay one row per token, OAuth
 * access tokens are grouped by refresh-token family. Both lists only include
 * credentials that can still authenticate, and are merged newest-used first
 * with never-used rows at the end.
 */
export async function listAdminMcpTokens(
  workspaceId: number,
  q: Queryable = db,
): Promise<AdminMcpToken[]> {
  const pats = await q.query(
    `SELECT t.id, t.user_id, u.name AS user_name, u.email AS user_email,
       t.name, t.scopes, t.created_at::text AS created_at,
       t.last_used_at::text AS last_used_at
     FROM mcp_tokens t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.workspace_id = $1
       AND t.kind = 'pat'
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [workspaceId],
  );

  const oauth = await q.query(
    `WITH family_rows AS (
       SELECT r.family_id, r.client_id, r.user_id, r.resource, r.scopes,
         r.created_at, r.id AS sort_id, 1 AS source_rank
       FROM oauth_refresh_tokens r
       WHERE r.workspace_id = $1
       UNION ALL
       SELECT t.oauth_family_id AS family_id, t.oauth_client_id AS client_id,
         t.user_id, t.resource, t.scopes, t.created_at, t.id AS sort_id, 2 AS source_rank
       FROM mcp_tokens t
       WHERE t.workspace_id = $1
         AND t.kind = 'oauth'
         AND t.oauth_family_id IS NOT NULL
     ),
     family_info AS (
       SELECT DISTINCT ON (family_id)
         family_id, client_id, user_id, resource, scopes
       FROM family_rows
       ORDER BY family_id, source_rank, created_at DESC, sort_id DESC
     ),
     first_seen AS (
       SELECT family_id, min(created_at) AS first_authorized_at
       FROM family_rows
       GROUP BY family_id
     ),
     valid_family AS (
       SELECT family_id
       FROM oauth_refresh_tokens
       WHERE workspace_id = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       UNION
       SELECT oauth_family_id AS family_id
       FROM mcp_tokens
       WHERE workspace_id = $1
         AND kind = 'oauth'
         AND oauth_family_id IS NOT NULL
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
     ),
     last_used AS (
       SELECT oauth_family_id AS family_id, max(last_used_at) AS last_used_at
       FROM mcp_tokens
       WHERE workspace_id = $1
         AND kind = 'oauth'
         AND oauth_family_id IS NOT NULL
       GROUP BY oauth_family_id
     )
     SELECT fi.family_id::text AS family_id,
       fi.client_id,
       fi.user_id,
       u.name AS user_name,
       u.email AS user_email,
       c.client_name,
       fi.resource,
       fi.scopes,
       fs.first_authorized_at::text AS first_authorized_at,
       lu.last_used_at::text AS last_used_at
     FROM valid_family vf
     JOIN family_info fi ON fi.family_id = vf.family_id
     JOIN first_seen fs ON fs.family_id = vf.family_id
     LEFT JOIN oauth_clients c ON c.client_id = fi.client_id
     LEFT JOIN users u ON u.id = fi.user_id
     LEFT JOIN last_used lu ON lu.family_id = vf.family_id
     ORDER BY lu.last_used_at DESC NULLS LAST, fi.family_id`,
    [workspaceId],
  );

  const rows: AdminMcpToken[] = [
    ...(pats.rows as PatRow[]).map((row): AdminPersonalToken => {
      const scopes = scopesOf(row.scopes);
      return {
        kind: "pat",
        id: Number(row.id),
        user_id: Number(row.user_id),
        user_name: displayName(row.user_name),
        user_email: displayName(row.user_email),
        name: row.name,
        scopes,
        read_only: !scopes.includes("write"),
        created_at: row.created_at,
        last_used_at: row.last_used_at,
      };
    }),
    ...(oauth.rows as OAuthRow[]).map((row): AdminOAuthToken => {
      const scopes = scopesOf(row.scopes);
      const endpoint = endpointFromResource(row.resource);
      return {
        kind: "oauth",
        family_id: row.family_id,
        user_id: Number(row.user_id),
        user_name: displayName(row.user_name),
        user_email: displayName(row.user_email),
        client_name: clientLabel(row),
        endpoint,
        scopes,
        read_only: endpoint === "readonly" || !scopes.includes("write"),
        first_authorized_at: row.first_authorized_at,
        last_used_at: row.last_used_at,
      };
    }),
  ];

  return rows.sort((a, b) => lastUsedTime(b.last_used_at) - lastUsedTime(a.last_used_at));
}

/**
 * Revoke another user's PAT. The token must belong to the workspace and be a
 * PAT; a missing, OAuth, or other-workspace id is reported as not found.
 * Repeated DELETE calls on an already revoked token stay successful.
 *
 * Lock order is users rows (ascending id) -> token row. The actor and owner are
 * locked before the UPDATE because admin user changes take the same user locks
 * and then revoke token rows, and the audit INSERT needs a share lock on the
 * actor row.
 */
export async function revokeAdminPersonalToken(
  actorId: number,
  workspaceId: number,
  tokenId: number,
  q: Queryable = db,
): Promise<{ id: number }> {
  if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw notFound("token not found");
  if (q === db) {
    return withTransaction((tx) => revokeAdminPersonalToken(actorId, workspaceId, tokenId, tx));
  }

  // Find the owner without a lock so both user rows can be taken in id order.
  const owned = await q.query(
    `SELECT t.user_id
     FROM mcp_tokens t
     WHERE t.id = $1
       AND t.workspace_id = $2
       AND t.kind = 'pat'`,
    [tokenId, workspaceId],
  );
  const owner = owned.rows[0] as { user_id: number } | undefined;
  if (!owner) throw notFound("token not found");
  await lockAdminAndOwner(q, actorId, Number(owner.user_id));

  const updated = await q.query(
    `UPDATE mcp_tokens t SET revoked_at = now()
     FROM users u
     WHERE t.id = $1
       AND t.workspace_id = $2
       AND t.kind = 'pat'
       AND t.revoked_at IS NULL
       AND u.id = t.user_id
     RETURNING t.id, t.name, t.user_id, u.name AS user_name, u.email AS user_email`,
    [tokenId, workspaceId],
  );
  const row = updated.rows[0] as RevokedPatRow | undefined;
  if (row) {
    await audit(actorId, "mcp.token.admin_revoke", {
      entity: "mcp_token",
      entityId: Number(row.id),
      workspaceId,
      summary: `MCP パーソナルアクセストークンを管理者が失効: ${row.name}（${targetLabel(row)}）`,
    }, q);
  }
  // Already revoked: keep DELETE idempotent for retries.
  return { id: tokenId };
}

/**
 * Revoke every access and refresh token in another user's OAuth family.
 * Lock order is users rows (ascending id) -> family advisory lock -> token
 * rows. Rotation and code exchange take the same order, and admin user changes
 * lock the acting administrator and owner together before revoking tokens. The
 * audit INSERT also needs a share lock on the actor row, so locking only the
 * owner could deadlock with a reset or deactivation of that owner.
 */
export async function revokeAdminOAuthFamily(
  actorId: number,
  workspaceId: number,
  familyId: string,
  q: Queryable = db,
): Promise<{ family_id: string }> {
  if (!FAMILY_ID_FORMAT.test(familyId)) throw notFound("connection not found");
  if (q === db) {
    return withTransaction((tx) => revokeAdminOAuthFamily(actorId, workspaceId, familyId, tx));
  }

  const owned = await q.query(
    `SELECT owner.user_id, owner.client_name,
       u.name AS user_name, u.email AS user_email
     FROM (
       SELECT r.user_id, c.client_name, r.id AS sort_id, 1 AS source_rank
       FROM oauth_refresh_tokens r
       LEFT JOIN oauth_clients c ON c.client_id = r.client_id
       WHERE r.family_id = $1::uuid AND r.workspace_id = $2
       UNION ALL
       SELECT t.user_id, t.client_name, t.id AS sort_id, 2 AS source_rank
       FROM mcp_tokens t
       WHERE t.oauth_family_id = $1::uuid
         AND t.workspace_id = $2
         AND t.kind = 'oauth'
     ) owner
     LEFT JOIN users u ON u.id = owner.user_id
     ORDER BY owner.source_rank, owner.sort_id DESC
     LIMIT 1`,
    [familyId, workspaceId],
  );
  const owner = owned.rows[0] as OAuthOwnerRow | undefined;
  if (!owner) throw notFound("connection not found");
  const userId = Number(owner.user_id);

  // Rotation, code exchange, and admin resets all lock user rows before token
  // rows; the actor must be included so the audit INSERT cannot cycle.
  const lockedIds = await lockAdminAndOwner(q, actorId, userId);
  if (!lockedIds.includes(userId)) throw notFound("connection not found");

  // Rotation inserts new token rows into the same family. Serialize with it so
  // the UPDATEs below also revoke pairs committed by an in-flight refresh.
  await lockOAuthFamily(q, familyId);

  const access = await q.query(
    `UPDATE mcp_tokens SET revoked_at = now()
     WHERE oauth_family_id = $1::uuid
       AND workspace_id = $2
       AND user_id = $3
       AND revoked_at IS NULL`,
    [familyId, workspaceId, userId],
  );
  const refresh = await q.query(
    `UPDATE oauth_refresh_tokens SET revoked_at = now()
     WHERE family_id = $1::uuid
       AND workspace_id = $2
       AND user_id = $3
       AND revoked_at IS NULL`,
    [familyId, workspaceId, userId],
  );

  if ((access.rowCount ?? 0) + (refresh.rowCount ?? 0) > 0) {
    await audit(actorId, "mcp.oauth.admin_revoke", {
      entity: "oauth_client",
      workspaceId,
      summary: `OAuth 連携を管理者が失効: ${displayName(owner.client_name) ?? familyId}（${targetLabel({
        user_id: userId,
        user_name: owner.user_name,
        user_email: owner.user_email,
      })}）`,
    }, q);
  }
  return { family_id: familyId };
}

/**
 * Workspace MCP request log for the admin screen. Cursor paging matches the
 * SCIM log endpoint: newest id first, PAGE_SIZE rows, next cursor is the last
 * returned id. Tool name falls back to the RPC method in the UI; token name is
 * the PAT name or the OAuth client name.
 */
export async function listAdminMcpRequestLogs(
  workspaceId: number,
  options: { outcome: McpLogOutcomeFilter; cursor: number | null },
  q: Queryable = db,
): Promise<{ logs: AdminMcpLog[]; nextCursor: number | null }> {
  const params: unknown[] = [workspaceId];
  const where = ["l.workspace_id = $1"];
  if (options.outcome !== "all") {
    params.push(options.outcome);
    where.push(`l.outcome = $${params.length}`);
  }
  if (options.cursor !== null) {
    params.push(options.cursor);
    where.push(`l.id < $${params.length}`);
  }

  const result = await q.query(
    `SELECT l.id, l.token_id,
       CASE WHEN t.kind = 'oauth' THEN t.client_name ELSE t.name END AS token_name,
       l.user_id, u.name AS user_name, u.email AS user_email,
       l.endpoint, l.rpc_method, l.tool_name, l.outcome, l.error_code,
       l.duration_ms, l.client_name, l.client_ip,
       l.created_at::text AS created_at
     FROM mcp_request_log l
     LEFT JOIN mcp_tokens t ON t.id = l.token_id
     LEFT JOIN users u ON u.id = l.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.id DESC
     LIMIT ${MCP_LOG_PAGE_SIZE + 1}`,
    params,
  );

  const rows = (result.rows as AdminMcpLog[]).slice(0, MCP_LOG_PAGE_SIZE);
  const nextCursor = result.rows.length > MCP_LOG_PAGE_SIZE
    ? Number(rows[rows.length - 1]?.id ?? 0) || null
    : null;
  return { logs: rows, nextCursor };
}
