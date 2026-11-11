import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";

export const GET = withUser(async (_req, { uid: id }) => {
  const r = await db.query(
    `SELECT id, name, email, title, avatar_url, is_guest, is_admin, role_id, totp_enabled
     FROM users WHERE id = $1 AND deactivated_at IS NULL`,
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}, { inactiveStatus: 404 });

export const PATCH = withUser(async (req, { uid: id }) => {
  try {
    await guardAuthRequest(req, "profile");
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    throw error;
  }
  const me = await db.query(
    "SELECT id, name, email, password_hash FROM users WHERE id = $1 AND deactivated_at IS NULL",
    [id],
  );
  if (me.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body?.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim().slice(0, 120));
    sets.push(`name = $${values.length}`);
  }
  if (typeof body?.email === "string" && body.email.trim() !== "") {
    const email = body.email.trim().toLowerCase().slice(0, 255);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    values.push(email);
    sets.push(`email = $${values.length}`);
  }
  if (typeof body?.title === "string") {
    values.push(body.title.trim().slice(0, 120));
    sets.push(`title = $${values.length}`);
  }
  if (typeof body?.avatar_url === "string") {
    const avatar = body.avatar_url.trim();
    if (avatar !== "") {
      try {
        const parsed = new URL(avatar);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      } catch {
        return NextResponse.json({ error: "avatar_url must be an http(s) URL" }, { status: 400 });
      }
    }
    values.push(avatar.slice(0, 500) || null);
    sets.push(`avatar_url = $${values.length}`);
  }
  const wantsPassword = typeof body?.new_password === "string" && body.new_password !== "";
  if (wantsPassword) {
    let attempt;
    try {
      attempt = await reserveAuthAttempt("password-change", String(id), POLICIES["password-change"]);
    } catch (error) {
      const limited = authRateLimitResponse(error);
      if (limited) return limited;
      throw error;
    }
    const passwordError = await validatePassword(String(body.new_password));
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const current = typeof body?.current_password === "string" ? body.current_password : "";
    const stored = me.rows[0].password_hash as string | null;
    if (!stored || !verifyPassword(current, stored)) {
      return NextResponse.json({ error: "current password mismatch" }, { status: 401 });
    }
    try {
      await attempt.release();
    } catch (error) {
      const limited = authRateLimitResponse(error);
      if (limited) return limited;
      throw error;
    }
    values.push(hashPassword(String(body.new_password)));
    sets.push(`password_hash = $${values.length}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "name or new_password required" }, { status: 400 });
  }
  values.push(id);
  try {
    await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  }
  const r = await db.query(
    `SELECT id, name, email, title, avatar_url, is_guest, is_admin, role_id, totp_enabled
     FROM users WHERE id = $1 AND deactivated_at IS NULL`,
    [id],
  );
  return NextResponse.json(r.rows[0]);
}, { inactiveStatus: 404 });
