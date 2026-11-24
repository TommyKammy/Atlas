import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

/** Successful responses are reusable for 24 hours, matching the janitor. */
export const MCP_IDEMPOTENCY_TTL_HOURS = 24;
/** An abandoned in-flight reservation may be taken over after this delay. */
export const MCP_IDEMPOTENCY_STALE_MINUTES = 5;
export const MCP_IDEMPOTENCY_KEY_MAX_LENGTH = 200;

export type IdempotencyInput = {
  tokenId: number;
  toolName: string;
  /** Omitted or null means the tool is not idempotent for this call. */
  key?: string | null;
  args: unknown;
};

type StoredIdempotencyRow = {
  id: number | string;
  request_hash: string;
  response: unknown;
  in_flight: boolean;
};

const BAD_KEY_MESSAGE =
  `idempotency_key must be a string of 1 to ${MCP_IDEMPOTENCY_KEY_MAX_LENGTH} characters`;

/**
 * JSON with recursively sorted object keys, so semantically identical tool
 * arguments produce the same hash regardless of property order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function idempotencyRequestHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

function normalizeKey(key: unknown): string | null {
  if (key === undefined || key === null) return null;
  if (typeof key !== "string") {
    throw new ApiError(400, BAD_KEY_MESSAGE, "bad_request");
  }
  const length = [...key].length;
  if (length < 1 || length > MCP_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiError(400, BAD_KEY_MESSAGE, "bad_request");
  }
  return key;
}

function assertIdentity(tokenId: number, toolName: string) {
  if (!Number.isSafeInteger(tokenId) || tokenId <= 0
      || typeof toolName !== "string" || toolName.length === 0) {
    throw new ApiError(400, "invalid idempotency identity", "bad_request");
  }
}

function storedResponse<T>(response: unknown): T {
  return (typeof response === "string" ? JSON.parse(response) : response) as T;
}

/**
 * Run a create tool at most once per (token, tool, idempotency_key).
 *
 * The reservation is a committed row with response IS NULL. A concurrent call
 * for the same key sees that row, does not run the tool, and receives a 409
 * "in progress" error rather than duplicating the write. When `run` throws, the
 * reservation is deleted so the client can retry immediately.
 */
export async function withIdempotency<T>(
  input: IdempotencyInput,
  run: () => Promise<T>,
): Promise<T> {
  const key = normalizeKey(input.key);
  if (key === null) return run();
  assertIdentity(input.tokenId, input.toolName);

  const requestHash = idempotencyRequestHash(input.args);
  const reserved = await db.query(
    `INSERT INTO mcp_idempotency
       (token_id, tool_name, idempotency_key, request_hash, response)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (token_id, tool_name, idempotency_key) DO UPDATE SET
       request_hash = EXCLUDED.request_hash,
       response = NULL,
       created_at = now()
     WHERE mcp_idempotency.created_at
             <= now() - make_interval(hours => $5::int)
        OR (mcp_idempotency.response IS NULL
            AND mcp_idempotency.created_at
              <= now() - make_interval(mins => $6::int))
     RETURNING id`,
    [
      input.tokenId,
      input.toolName,
      key,
      requestHash,
      MCP_IDEMPOTENCY_TTL_HOURS,
      MCP_IDEMPOTENCY_STALE_MINUTES,
    ],
  );

  if (reserved.rows.length > 0) {
    const reservationId = reserved.rows[0].id as number | string;
    let result: T;
    try {
      result = await run();
    } catch (error) {
      // A failed call must remain retryable.
      await db.query("DELETE FROM mcp_idempotency WHERE id = $1", [reservationId])
        .catch(() => undefined);
      throw error;
    }
    let payload: string;
    try {
      payload = JSON.stringify(result ?? null);
    } catch (error) {
      await db.query("DELETE FROM mcp_idempotency WHERE id = $1", [reservationId])
        .catch(() => undefined);
      throw error;
    }
    await db.query(
      "UPDATE mcp_idempotency SET response = $2::jsonb WHERE id = $1",
      [reservationId, payload],
    );
    return result;
  }

  const existing = await db.query(
    `SELECT id, request_hash, response, (response IS NULL) AS in_flight
       FROM mcp_idempotency
      WHERE token_id = $1 AND tool_name = $2 AND idempotency_key = $3`,
    [input.tokenId, input.toolName, key],
  );
  const row = existing.rows[0] as StoredIdempotencyRow | undefined;
  if (!row) {
    // The reservation disappeared between statements (janitor or a failed
    // takeover). Never execute the write without a reservation.
    throw new ApiError(409, "idempotency key is already in progress", "conflict");
  }
  if (row.request_hash !== requestHash) {
    throw new ApiError(409, "idempotency key reused with different arguments", "conflict");
  }
  if (row.in_flight === true) {
    throw new ApiError(409, "idempotency key is already in progress", "conflict");
  }
  return storedResponse<T>(row.response);
}
