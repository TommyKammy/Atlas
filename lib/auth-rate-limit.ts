import { createHash } from "node:crypto";
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { queryAtRequestBoundary, type Queryable } from "./db";
import { verifiedAuthClientIp } from "./auth-client-ip.mjs";

export type AuthRatePolicy = { readonly limit: number; readonly windowSeconds: number };

export const POLICIES = {
  "login-account": { limit: 40, windowSeconds: 15 * 60 },
  "mfa-verify": { limit: 10, windowSeconds: 5 * 60 },
  "mfa-manage": { limit: 10, windowSeconds: 5 * 60 },
  "mfa-enroll": { limit: 5, windowSeconds: 10 * 60 },
  "password-change": { limit: 10, windowSeconds: 15 * 60 },
  invitation: { limit: 30, windowSeconds: 15 * 60 },
  "saml-start": { limit: 120, windowSeconds: 5 * 60 },
  "saml-callback": { limit: 120, windowSeconds: 5 * 60 },
  global: { limit: 6000, windowSeconds: 60 },
  peer: { limit: 500, windowSeconds: 60 },
} as const satisfies Record<string, AuthRatePolicy>;

export const AUTH_RATE_CLEANUP_BATCH = 100;

export class AuthRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("too many authentication attempts");
    this.name = "AuthRateLimitError";
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

export class AuthRateLimitUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super("authentication temporarily unavailable");
    this.name = "AuthRateLimitUnavailableError";
  }
}

const defaultStore: Queryable = { query: queryAtRequestBoundary };

export function authRateIdentityHash(scope: string, identity: string): string {
  return createHash("sha256").update(JSON.stringify([scope, identity])).digest("hex");
}

function validatePolicy(scope: string, identity: string, policy: AuthRatePolicy) {
  if (!/^[a-z0-9_-]{1,64}$/.test(scope) || typeof identity !== "string" || !identity ||
      !Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.limit > 1_000_000 ||
      !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86_400) {
    throw new TypeError("invalid authentication rate policy");
  }
}

/** Bounded deletion avoids unbounded maintenance work on a login request. */
export async function cleanupAuthRateLimits(store: Queryable = defaultStore) {
  if (store === defaultStore) await connection();
  try {
    await store.query(`DELETE FROM auth_rate_limits expired USING (
      SELECT scope,identity_hash FROM auth_rate_limits
      WHERE expires_at<=clock_timestamp() ORDER BY expires_at,scope,identity_hash
      LIMIT $1 FOR UPDATE SKIP LOCKED
    ) batch WHERE expired.scope=batch.scope AND expired.identity_hash=batch.identity_hash`, [AUTH_RATE_CLEANUP_BATCH]);
  } catch {
    throw new AuthRateLimitUnavailableError();
  }
}

/**
 * Atomically reserve one attempt before credential verification. Successful
 * verification may return only its own reservation; failures are never reset.
 * Queryable injection is an internal test seam, not an HTTP input.
 */
export async function reserveAuthAttempt(
  scope: string,
  identity: string,
  policy: AuthRatePolicy,
  store: Queryable = defaultStore,
): Promise<{ release: (transactionStore?: Queryable) => Promise<void> }> {
  validatePolicy(scope, identity, policy);
  // Do not translate Next's request-time/prerender control exception into a 503.
  if (store === defaultStore) await connection();
  const hash = authRateIdentityHash(scope, identity);
  let windowId: string;
  try {
    await cleanupAuthRateLimits(store);
    const result = await store.query(`INSERT INTO auth_rate_limits
      (scope,identity_hash,attempts,window_started_at,expires_at)
      VALUES ($1,$2,1,clock_timestamp(),clock_timestamp()+make_interval(secs=>$3::int))
      ON CONFLICT (scope,identity_hash) DO UPDATE SET
        attempts=CASE WHEN auth_rate_limits.expires_at<=EXCLUDED.window_started_at THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_id=CASE WHEN auth_rate_limits.expires_at<=EXCLUDED.window_started_at THEN EXCLUDED.window_id ELSE auth_rate_limits.window_id END,
        window_started_at=CASE WHEN auth_rate_limits.expires_at<=EXCLUDED.window_started_at THEN EXCLUDED.window_started_at ELSE auth_rate_limits.window_started_at END,
        expires_at=CASE WHEN auth_rate_limits.expires_at<=EXCLUDED.window_started_at THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
      WHERE auth_rate_limits.expires_at<=EXCLUDED.window_started_at OR auth_rate_limits.attempts<$4::int
      RETURNING window_id::text AS window_id`, [scope, hash, policy.windowSeconds, policy.limit]);
    if (result.rows.length === 0) {
      const blocked = await store.query(`SELECT greatest(1,ceil(extract(epoch FROM expires_at-clock_timestamp())))::int AS retry_after
        FROM auth_rate_limits WHERE scope=$1 AND identity_hash=$2`, [scope, hash]);
      throw new AuthRateLimitError(Number(blocked.rows[0]?.retry_after ?? 1));
    }
    windowId = result.rows[0].window_id as string;
    if (typeof windowId !== "string" || !windowId) throw new AuthRateLimitUnavailableError();
  } catch (error) {
    if (error instanceof AuthRateLimitError || error instanceof AuthRateLimitUnavailableError) throw error;
    throw new AuthRateLimitUnavailableError();
  }
  let released = false;
  return { release: async (transactionStore = store) => {
    if (released) return;
    // Fence this call synchronously, including concurrent release() calls.
    released = true;
    try {
      await transactionStore.query(`UPDATE auth_rate_limits SET attempts=greatest(0,attempts-1)
        WHERE scope=$1 AND identity_hash=$2 AND window_id=$3::uuid`, [scope, hash, windowId]);
    } catch {
      throw new AuthRateLimitUnavailableError();
    }
  } };
}

/** Aggregate admission is common to all authentication endpoints. */
export async function guardAuthRequest(req: Request, _endpoint: string, store: Queryable = defaultStore) {
  await reserveAuthAttempt("global", "all-authentication", POLICIES.global, store);
  const ip = verifiedAuthClientIp(req);
  if (ip) await reserveAuthAttempt("peer", ip, POLICIES.peer, store);
}

export function authRateLimitResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthRateLimitError) {
    return NextResponse.json({ error: "too_many_attempts", retry_after_seconds: error.retryAfter }, {
      status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
    });
  }
  if (error instanceof AuthRateLimitUnavailableError) {
    return NextResponse.json({ error: "auth_temporarily_unavailable" }, {
      status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  return null;
}
