import { cookies } from "next/headers";
import { db } from "./db";

export const COOKIE_NAME = "atlas_uid";
export const DEFAULT_USER_ID = 1;

// Server-component view of the session. Returns null when no session cookie
// is present (anonymous) — callers decide the fallback. Never silently
// impersonate the default user.
export async function getCurrentUserId(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw === undefined) return null;
  const v = Number(raw);
  if (!Number.isInteger(v) || v <= 0) return null;
  const r = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [v]);
  return (r.rowCount ?? 0) > 0 ? v : null;
}

export function getCurrentUserIdFromRequest(req: Request): number {
  const header = req.headers.get("cookie") ?? "";
  const m = header.match(/(?:^|;\s*)atlas_uid=(\d+)/);
  const v = m ? Number(m[1]) : NaN;
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_USER_ID;
}
