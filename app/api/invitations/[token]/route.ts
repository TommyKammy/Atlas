import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { getSecuritySettings, requiresSaml } from "@/lib/admin-data";
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
  const security = await getSecuritySettings();
  let outcome: Response | {
    user: Record<string, unknown>;
    sessionToken: string | null;
    mfaPending: boolean;
    samlRequired: boolean;
  };
  try {
    outcome = await withTransaction(async (q) => {
      const inv = await q.query(
        "SELECT id, email, role, accepted_at, expires_at FROM invitations WHERE token = $1 FOR UPDATE",
        [token],
      );
      if (inv.rowCount === 0) {
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
        return NextResponse.json({ error: "invitation is invalid or expired" }, { status: 410 });
      }
      const role = await getRoleByKey(row.role);
      if (!role) {
        return NextResponse.json({ error: "invalid invitation role" }, { status: 400 });
      }
      const existing = await q.query("SELECT id FROM users WHERE email = $1", [row.email]);
      if ((existing.rowCount ?? 0) > 0) {
        return NextResponse.json({ error: "user already exists" }, { status: 409 });
      }
      const user = await q.query(
        `INSERT INTO users (name, email, is_guest, is_admin, role_id, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, email, is_guest, is_admin, role_id`,
        [name, row.email, role.isGuest, role.isAdmin, role.id, hashPassword(password)],
      );
      await q.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [row.id]);
      const samlRequired = requiresSaml(security.saml_mode, user.rows[0]);
      const mfaPending = !samlRequired && security.two_factor_policy === "required";
      const sessionToken = samlRequired ? null : await createSession(Number(user.rows[0].id), {
        userAgent: req.headers.get("user-agent"),
        mfaPending,
      }, q);
      return { user: user.rows[0], sessionToken, mfaPending, samlRequired };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  }

  if (outcome instanceof Response) return outcome;
  const res = NextResponse.json({
    ...outcome.user,
    two_factor_setup_required: outcome.mfaPending,
    saml_required: outcome.samlRequired,
  }, { status: 201 });
  if (outcome.sessionToken) res.cookies.set(SESSION_COOKIE, outcome.sessionToken, sessionCookieOptions());
  return res;
}
