import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/session-token";

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  isGuest: boolean;
};

function sessionCookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "1" || process.env.APP_URL?.startsWith("https://") === true;
}

/** Cookie options used by login and logout. */
export function sessionCookieOptions() {
  return {
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: sessionCookieSecure(),
  };
}

async function loadSessionByToken(token: string): Promise<SessionUser | null> {
  if (!isSessionToken(token)) return null;
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.is_admin, u.is_guest
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.deactivated_at IS NULL`,
    [hashSessionToken(token)],
  );
  const row = r.rows[0] as
    | { id: number; name: string; email: string; is_admin: boolean; is_guest: boolean }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    isAdmin: row.is_admin === true,
    isGuest: row.is_guest === true,
  };
}

/** Create a server-side session and return the raw cookie token. */
export async function createSession(userId: number, userAgent?: string | null): Promise<string> {
  const token = generateSessionToken();
  await db.query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2::bigint, now() + make_interval(secs => $3), $4)`,
    [hashSessionToken(token), userId, SESSION_TTL_SECONDS, userAgent?.slice(0, 500) ?? null],
  );
  // Opportunistic cleanup; failure must not block login.
  await db
    .query("DELETE FROM user_sessions WHERE expires_at <= now()")
    .catch(() => undefined);
  return token;
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
const requestSessions = new WeakMap<Request, Promise<SessionUser | null>>();

export function getRequestSession(req: Request): Promise<SessionUser | null> {
  const cached = requestSessions.get(req);
  if (cached) return cached;
  const token = tokenFromCookieHeader(req.headers.get("cookie"));
  const pending = token === null ? Promise.resolve(null) : loadSessionByToken(token);
  requestSessions.set(req, pending);
  return pending;
}

/** Server-component session; cached per React request. */
export const getServerSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token && isSessionToken(token) ? loadSessionByToken(token) : null;
});
