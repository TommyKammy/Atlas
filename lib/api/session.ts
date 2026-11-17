import { cache } from "react";
import { cookies } from "next/headers";
import { db, type Queryable } from "@/lib/db";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/session-token";
import { SamlSessionRequiredError, type SessionAuthMethod } from "@/lib/session-policy";

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

/** Acquire before user/session mutation rows in a transaction that issues credentials. */
export async function lockSessionPolicy(q: Queryable) {
  await q.query(`SELECT workspace_id FROM workspace_security
    WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1) FOR SHARE`);
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  isGuest: boolean;
};

type SessionAccess = {
  user: SessionUser;
  mfaPending: boolean;
  mfaEnabled: boolean;
  tokenHash: string;
};

function sessionCookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "1"
    || process.env.APP_URL?.startsWith("https://") === true
    || process.env.APP_ORIGIN?.startsWith("https://") === true;
}

/** Cookie options used by login and logout. */
export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    path: "/",
    maxAge,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: sessionCookieSecure(),
  };
}

export async function loadSessionByToken(token: string, q: Queryable = db): Promise<SessionAccess | null> {
  if (!isSessionToken(token)) return null;
  const tokenHash = hashSessionToken(token);
  const r = await q.query(
    `SELECT u.id, u.name, u.email, u.is_admin, u.is_guest, u.totp_enabled,
       s.mfa_enrollment_only OR COALESCE(w.two_factor_policy = 'required' AND (
         NOT u.totp_enabled OR s.created_at < COALESCE(u.totp_enrolled_at, '-infinity'::timestamptz)
       ), false) AS mfa_pending
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN workspace_security w ON w.workspace_id = (SELECT id FROM workspaces ORDER BY id LIMIT 1)
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.deactivated_at IS NULL
       AND (s.auth_method = 'saml' OR u.is_admin OR w.saml_mode IS NULL
         OR w.saml_mode IN ('off','optional') OR (w.saml_mode='members_only' AND u.is_guest))`,
    [tokenHash],
  );
  const row = r.rows[0] as
    | { id: number; name: string; email: string; is_admin: boolean; is_guest: boolean; totp_enabled: boolean; mfa_pending: boolean }
    | undefined;
  if (!row) return null;
  return {
    user: {
      id: Number(row.id),
      name: row.name,
      email: row.email,
      isAdmin: row.is_admin === true,
      isGuest: row.is_guest === true,
    },
    mfaPending: row.mfa_pending,
    mfaEnabled: row.totp_enabled,
    tokenHash,
  };
}

/** Create a server-side session and return the raw cookie token. */
export async function createSession(
  userId: number,
  { userAgent, maxAge = SESSION_TTL_SECONDS, mfaPending = false, authMethod = "password" }: {
    userAgent?: string | null;
    maxAge?: number;
    mfaPending?: boolean;
    authMethod?: SessionAuthMethod;
  } = {},
  q?: Queryable,
): Promise<string> {
  const token = generateSessionToken();
  const created = await (q ?? db).query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent, mfa_enrollment_only, auth_method)
     VALUES ($1, $2::bigint, now() + make_interval(secs => $3), $4, $5, $6)
     RETURNING token_hash`,
    [hashSessionToken(token), userId, maxAge, userAgent?.slice(0, 500) ?? null, mfaPending, authMethod],
  );
  if (created.rowCount !== 1) throw new SamlSessionRequiredError();
  // The janitor also removes expired sessions. Keep this opportunistic cleanup
  // outside any transaction that needs the session insert to succeed atomically.
  if (!q) await db.query("DELETE FROM user_sessions WHERE expires_at <= now()").catch(() => undefined);
  return token;
}

/** Replace the previous credential after MFA while preserving its expiry. */
export async function rotateSessionAfterMfa(q: Queryable, access: SessionAccess) {
  // Settings revocation locks policy before sessions. Keep the same order here
  // rather than deleting the old session and then waiting in the insert trigger.
  await lockSessionPolicy(q);
  const token = generateSessionToken();
  const r = await q.query(
    `WITH previous AS (
       DELETE FROM user_sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()
       RETURNING user_id, expires_at, user_agent, auth_method
     )
     INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent, auth_method)
     SELECT $3, user_id, expires_at, user_agent, auth_method FROM previous
     RETURNING floor(extract(epoch FROM expires_at - now()))::int AS max_age`,
    [access.tokenHash, access.user.id, hashSessionToken(token)],
  );
  const maxAge = r.rows[0]?.max_age as number | undefined;
  return maxAge === undefined ? null : { token, maxAge };
}

/** Revoke one session token (logout). */
export async function revokeSession(token: string): Promise<void> {
  if (!isSessionToken(token)) return;
  await db.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
}

function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)atlas_session=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match?.[1] ?? null;
}

// Route handlers receive one Request object for the whole request. Cache the
// validated session so a handler and its authorization helpers share one query.
const requestSessions = new WeakMap<Request, Promise<SessionAccess | null>>();

/** Includes sessions waiting for MFA. Use only for the MFA route. */
export function getMfaRequestSession(req: Request): Promise<SessionAccess | null> {
  const cached = requestSessions.get(req);
  if (cached) return cached;
  const token = tokenFromCookieHeader(req.headers.get("cookie"));
  const pending = token === null ? Promise.resolve(null) : loadSessionByToken(token);
  requestSessions.set(req, pending);
  return pending;
}

export async function getRequestSession(req: Request): Promise<SessionUser | null> {
  const access = await getMfaRequestSession(req);
  return access?.mfaPending ? null : access?.user ?? null;
}

/** Includes sessions waiting for MFA. Use only for the profile setup page. */
export const getMfaServerSession = cache(async (): Promise<SessionAccess | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token && isSessionToken(token) ? loadSessionByToken(token) : null;
});

export const getServerSession = cache(async (): Promise<SessionUser | null> => {
  const access = await getMfaServerSession();
  return access?.mfaPending ? null : access?.user ?? null;
});
