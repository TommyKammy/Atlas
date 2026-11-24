import { db, type Queryable } from "@/lib/db";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import type { McpEndpoint } from "./auth";

export type McpRequestOutcome = "ok" | "error" | "denied" | "unauthenticated";

export type McpRequestLogEntry = {
  /** Resolved token workspace; null for failures before authentication. */
  workspaceId: number | null;
  tokenId: number | null;
  userId: number | null;
  endpoint: McpEndpoint;
  rpcMethod: string | null;
  toolName: string | null;
  outcome: McpRequestOutcome;
  errorCode: string | null;
  durationMs: number;
  clientName: string | null;
  clientIp: string | null;
};

/** Bound values that originate in request bodies before they reach the log. */
export function trimMcpLogText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, maxLength);
}

/**
 * Persist one MCP request. Request bodies, tool arguments, Authorization
 * headers and token values are never accepted by this function.
 *
 * A failed write must never fail the MCP request, so every error is swallowed
 * after being reported to the server log.
 */
export async function recordMcpRequest(
  entry: McpRequestLogEntry,
  store: Queryable = db,
): Promise<void> {
  try {
    await store.query(
      `INSERT INTO mcp_request_log
         (workspace_id, token_id, user_id, endpoint, rpc_method, tool_name,
          outcome, error_code, duration_ms, client_name, client_ip)
       VALUES (
         COALESCE($1::bigint, (SELECT id FROM workspaces ORDER BY id LIMIT 1)),
         $2::bigint,
         (SELECT id FROM users WHERE id = $3::bigint),
         $4, $5, $6, $7, $8, $9, $10, $11
       )`,
      [
        entry.workspaceId,
        entry.tokenId,
        entry.userId,
        entry.endpoint,
        trimMcpLogText(entry.rpcMethod, 100),
        trimMcpLogText(entry.toolName, 200),
        entry.outcome,
        trimMcpLogText(entry.errorCode, 100),
        Math.max(0, Math.trunc(entry.durationMs)),
        trimMcpLogText(entry.clientName, 200),
        entry.clientIp,
      ],
    );
  } catch (error) {
    // Avoid surfacing database details or Next.js prerender control errors.
    const message = error instanceof Error ? error.message : String(error);
    console.error("MCP request log write failed:", message);
  }
}

/** Client IP resolution is shared with the authentication rate limiter. */
export function mcpClientIp(req: Request): string | null {
  return verifiedAuthClientIp(req);
}
