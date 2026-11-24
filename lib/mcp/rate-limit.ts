import { ApiError } from "@/lib/api/errors";
import {
  AuthRateLimitError,
  AuthRateLimitUnavailableError,
  POLICIES,
  reserveAuthAttempt,
} from "@/lib/auth-rate-limit";
import type { Queryable } from "@/lib/db";

export const MCP_WRITE_POLICY = POLICIES["mcp-write"];

/**
 * Consume one unit of the per-token write budget. Write tools call this before
 * running the operation; reads are not affected. A successful reservation is
 * deliberately not refunded because writes are the resource being limited.
 *
 * `store` is an internal test seam, matching reserveAuthAttempt.
 */
export async function enforceMcpWriteLimit(
  tokenId: number,
  store?: Queryable,
): Promise<void> {
  if (!Number.isSafeInteger(tokenId) || tokenId <= 0) {
    throw new ApiError(400, "invalid MCP token id", "bad_request");
  }
  try {
    await reserveAuthAttempt("mcp-write", String(tokenId), MCP_WRITE_POLICY, store);
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      throw new ApiError(
        429,
        `MCP write rate limit exceeded; retry after ${error.retryAfter} seconds`,
        "rate_limited",
        { retry_after_seconds: error.retryAfter },
      );
    }
    if (error instanceof AuthRateLimitUnavailableError) {
      throw new ApiError(
        503,
        "MCP write rate limit is temporarily unavailable",
        "rate_limit_unavailable",
      );
    }
    throw error;
  }
}
