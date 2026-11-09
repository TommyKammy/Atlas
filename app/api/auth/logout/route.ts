import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  res.cookies.set("atlas_uid", "", { path: "/", maxAge: 0 });
  return res;
}
