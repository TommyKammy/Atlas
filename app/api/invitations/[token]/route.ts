import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/current-user";
import { validatePassword } from "@/lib/password-policy";
import { getRoleByKey } from "@/lib/permissions";

async function loadInvitation(token: string) {
  const r = await db.query(
    `SELECT i.id, i.email, i.role, i.expires_at::text AS expires_at, i.accepted_at,
       w.name AS workspace_name
     FROM invitations i LEFT JOIN workspaces w ON TRUE
     WHERE i.token = $1
     ORDER BY w.id LIMIT 1`,
    [token],
  );
  return r.rows[0] as
    | {
        id: number;
        email: string;
        role: string;
        expires_at: string;
        accepted_at: string | null;
        workspace_name: string | null;
      }
    | undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invite = await loadInvitation(token);
  if (!invite || invite.accepted_at || new Date(invite.expires_at) <= new Date()) {
    return NextResponse.json({ error: "invitation is invalid or expired" }, { status: 410 });
  }
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    workspace_name: invite.workspace_name ?? "Atlas",
    expires_at: invite.expires_at,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || password === "") {
    return NextResponse.json({ error: "name and password required" }, { status: 400 });
  }
  const passwordError = await validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const inv = await client.query(
      "SELECT id, email, role, accepted_at, expires_at FROM invitations WHERE token = $1 FOR UPDATE",
      [token],
    );
    if (inv.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "invitation not found" }, { status: 404 });
    }
    const row = inv.rows[0] as {
      id: number;
      email: string;
      role: string;
      accepted_at: string | null;
      expires_at: string;
    };
    if (row.accepted_at || new Date(row.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "invitation is invalid or expired" }, { status: 410 });
    }
    const role = await getRoleByKey(row.role);
    if (!role) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "invalid invitation role" }, { status: 400 });
    }
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [row.email]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "user already exists" }, { status: 409 });
    }
    const user = await client.query(
      `INSERT INTO users (name, email, is_guest, is_admin, role_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, is_guest, is_admin, role_id`,
      [name, row.email, role.isGuest, role.isAdmin, role.id, hashPassword(password)],
    );
    await client.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [row.id]);
    await client.query("COMMIT");
    const res = NextResponse.json(user.rows[0], { status: 201 });
    res.cookies.set(COOKIE_NAME, String(user.rows[0].id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
}
