import { NextResponse } from "next/server";
import { db, withTransaction, type Queryable } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { scimManagedChangeError } from "@/lib/scim/managed-user";
import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";

type ProfileRow = {
  id: number;
  name: string;
  email: string | null;
  password_hash: string | null;
  title: string;
  deactivated_at: string | null;
  scim_managed: boolean;
  scim_deleted: boolean;
  scim_enabled: boolean;
};

const PROFILE_ROW_SQL = `SELECT u.id, u.name, u.email, u.password_hash, u.title, u.deactivated_at,
       (si.id IS NOT NULL) AS scim_managed,
       (si.deleted_at IS NOT NULL) AS scim_deleted,
       COALESCE(
         (SELECT scim_enabled FROM workspace_security ORDER BY workspace_id LIMIT 1),
         false
       ) AS scim_enabled
     FROM users u
     LEFT JOIN scim_identities si ON si.user_id = u.id
     WHERE u.id = $1 AND u.deactivated_at IS NULL`;

async function loadProfileRow(q: Queryable, id: number, lock: boolean): Promise<ProfileRow | null> {
  const r = await q.query(lock ? `${PROFILE_ROW_SQL} FOR UPDATE OF u` : PROFILE_ROW_SQL, [id]);
  return (r.rows[0] as ProfileRow | undefined) ?? null;
}

function profileScimError(row: ProfileRow, body: unknown): string | null {
  if (row.scim_managed !== true) return null;
  return scimManagedChangeError(
    {
      scimEnabled: row.scim_enabled === true,
      scimManaged: true,
      scimDeleted: row.scim_deleted === true,
      deactivated: row.deactivated_at !== null,
      name: row.name,
      email: row.email,
      title: row.title,
    },
    (body ?? {}) as Record<string, unknown>,
  );
}

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
  const me = await loadProfileRow(db, id, false);
  if (!me) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const scimError = profileScimError(me, body);
  if (scimError) {
    return NextResponse.json({ error: scimError, code: "scim_managed" }, { status: 409 });
  }
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
    const stored = me.password_hash;
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
    // SCIM may bind this account between the first check and this write.
    // Lock the user row (SCIM locks it before binding) and check the SCIM
    // state again in the transaction that writes the profile.
    const blocked = await withTransaction(async (q) => {
      const locked = await loadProfileRow(q, id, true);
      if (!locked) return NextResponse.json({ error: "not found" }, { status: 404 });
      const lockedError = profileScimError(locked, body);
      if (lockedError) {
        return NextResponse.json({ error: lockedError, code: "scim_managed" }, { status: 409 });
      }
      await q.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      return null;
    });
    if (blocked) return blocked;
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
