import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "atlas_uid";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  isGuest: boolean;
};

function parseSessionId(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadSession(id: number): Promise<SessionUser | null> {
  const r = await db.query(
    `SELECT id, name, email, is_admin, is_guest
     FROM users WHERE id = $1 AND deactivated_at IS NULL`,
    [id],
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

// Route handlers receive one Request object for the whole request. Cache the
// validated session so a handler and its authorization helpers share one query.
const requestSessions = new WeakMap<Request, Promise<SessionUser | null>>();

export function getRequestSession(req: Request): Promise<SessionUser | null> {
  const cached = requestSessions.get(req);
  if (cached) return cached;
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)atlas_uid=(\d+)(?:;|$)/);
  const id = parseSessionId(match?.[1]);
  const pending = id === null ? Promise.resolve(null) : loadSession(id);
  requestSessions.set(req, pending);
  return pending;
}

/** Server-component session; cached per React request. */
export const getServerSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const id = parseSessionId(store.get(SESSION_COOKIE)?.value);
  return id === null ? null : loadSession(id);
});
