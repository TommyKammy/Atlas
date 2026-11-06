import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/current-user";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  const r = await db.query(
    "SELECT id, name, password_hash, deactivated_at FROM users WHERE email = $1",
    [email],
  );
  const row = r.rows[0] as
    | { id: number; name: string; password_hash: string | null; deactivated_at: string | null }
    | undefined;
  if (row?.deactivated_at) {
    return NextResponse.json({ error: "account is deactivated" }, { status: 403 });
  }
  if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const res = NextResponse.json({ id: row.id, name: row.name });
  res.cookies.set(COOKIE_NAME, String(row.id), {
    path: "/",
    maxAge: 7 * 24 * 3600,
    sameSite: "lax",
    httpOnly: true,
  });
  return res;
}
