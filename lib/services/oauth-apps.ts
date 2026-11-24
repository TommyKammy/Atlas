import { audit } from "../audit";
import { notFound } from "../api/errors";
import { db, withTransaction, type Queryable } from "../db";
import type { Actor } from "./actor";

export type OAuthAppEndpoint = "default" | "readonly";

export type OAuthAppSummary = {
  family_id: string;
  client_name: string;
  client_host: string | null;
  scopes: string[];
  endpoint: OAuthAppEndpoint;
  resource: string;
  first_authorized_at: string;
  last_used_at: string | null;
};

type OAuthAppRow = {
  family_id: string;
  client_id: string;
  client_name: string | null;
  scopes: string[] | null;
  resource: string;
  first_authorized_at: string;
  last_used_at: string | null;
};

const FAMILY_ID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientHost(clientId: string): string | null {
  try {
    const url = new URL(clientId);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function endpointFromResource(resource: string): OAuthAppEndpoint {
  try {
    return new URL(resource).pathname.endsWith("/mcp/readonly") ? "readonly" : "default";
  } catch {
    return "default";
  }
}

/**
 * Active OAuth connections grouped by refresh-token family. A family is valid
 * while it has at least one unrevoked, unexpired refresh token; rotated-away
 * rows stay in the same family and identify its first approval. Only the
 * actor's rows are ever selected.
 */
export async function listOAuthApps(
  actor: Actor,
  q: Queryable = db,
): Promise<OAuthAppSummary[]> {
  const result = await q.query(
    `WITH active AS (
       SELECT id, family_id, client_id, scopes, resource, created_at
       FROM oauth_refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ),
     first_seen AS (
       SELECT family_id, min(created_at) AS first_authorized_at
       FROM active
       GROUP BY family_id
     ),
     latest AS (
       SELECT DISTINCT ON (family_id) family_id, client_id, scopes, resource
       FROM active
       ORDER BY family_id, created_at DESC, id DESC
     )
     SELECT latest.family_id::text AS family_id,
       latest.client_id,
       c.client_name,
       latest.scopes,
       latest.resource,
       first_seen.first_authorized_at::text AS first_authorized_at,
       used.last_used_at::text AS last_used_at
     FROM latest
     JOIN first_seen ON first_seen.family_id = latest.family_id
     LEFT JOIN oauth_clients c ON c.client_id = latest.client_id
     LEFT JOIN (
       SELECT oauth_family_id, max(last_used_at) AS last_used_at
       FROM mcp_tokens
       WHERE user_id = $1 AND kind = 'oauth' AND oauth_family_id IS NOT NULL
       GROUP BY oauth_family_id
     ) used ON used.oauth_family_id = latest.family_id
     ORDER BY first_seen.first_authorized_at DESC, latest.family_id`,
    [actor.uid],
  );

  return (result.rows as OAuthAppRow[]).map((row) => {
    const host = clientHost(row.client_id);
    const name = typeof row.client_name === "string" ? row.client_name.trim() : "";
    return {
      family_id: row.family_id,
      client_name: name === "" ? (host ?? "動的に登録されたアプリ") : name,
      client_host: host,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      endpoint: endpointFromResource(row.resource),
      resource: row.resource,
      first_authorized_at: row.first_authorized_at,
      last_used_at: row.last_used_at,
    };
  });
}

/**
 * Revoke every access and refresh token in one of the actor's families.
 * Another user's family is indistinguishable from a missing one (404), and a
 * malformed id never reaches the database.
 */
export async function revokeOAuthApp(
  actor: Actor,
  familyId: string,
  q: Queryable = db,
): Promise<{ family_id: string }> {
  if (!FAMILY_ID_FORMAT.test(familyId)) throw notFound("connection not found");
  if (q === db) {
    return withTransaction((tx) => revokeOAuthApp(actor, familyId, tx));
  }

  const owned = await q.query(
    `SELECT family_id, workspace_id
     FROM oauth_refresh_tokens
     WHERE family_id = $1::uuid AND user_id = $2
     ORDER BY id
     LIMIT 1`,
    [familyId, actor.uid],
  );
  const row = owned.rows[0] as
    | { family_id: string; workspace_id: number }
    | undefined;
  if (!row) throw notFound("connection not found");

  // Same table order as revokeAllUserTokens and the OAuth family revocations.
  await q.query(
    `UPDATE mcp_tokens SET revoked_at = now()
     WHERE oauth_family_id = $1::uuid AND user_id = $2 AND revoked_at IS NULL`,
    [familyId, actor.uid],
  );
  await q.query(
    `UPDATE oauth_refresh_tokens SET revoked_at = now()
     WHERE family_id = $1::uuid AND user_id = $2 AND revoked_at IS NULL`,
    [familyId, actor.uid],
  );
  await audit(actor.uid, "mcp.oauth.revoke", {
    entity: "oauth_client",
    workspaceId: Number(row.workspace_id),
    summary: "OAuth 連携を解除",
  }, q);
  return { family_id: familyId };
}
