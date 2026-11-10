import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { consumeRecoveryCodeForUser } from "@/lib/api/mfa";
import { verifyTotp } from "@/lib/totp";
import { getSecuritySettings, requiresSaml } from "@/lib/admin-data";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const totp = typeof body?.totp === "string" ? body.totp.trim() : "";
  const recoveryCode = typeof body?.recovery_code === "string" ? body.recovery_code.trim() : "";
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  const r = await db.query(
    `SELECT id, name, password_hash, deactivated_at, is_admin, is_guest,
       totp_enabled, totp_secret
     FROM users WHERE email = $1`,
    [email],
  );
  const row = r.rows[0] as
    | {
        id: number;
        name: string;
        password_hash: string | null;
        deactivated_at: string | null;
        is_admin: boolean;
        is_guest: boolean;
        totp_enabled: boolean;
        totp_secret: string | null;
      }
    | undefined;
  if (row?.deactivated_at) {
    return NextResponse.json({ error: "account is deactivated" }, { status: 403 });
  }
  if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const security = await getSecuritySettings();
  if (requiresSaml(security.saml_mode, row)) {
    return NextResponse.json(
      {
        error: "SAML SSO is required for this workspace",
        saml_required: true,
        saml_start: "/api/auth/saml/start",
      },
      { status: 403 },
    );
  }

  const mfaPending = security.two_factor_policy === "required" && !row.totp_enabled;
  const sessionOptions = { userAgent: req.headers.get("user-agent"), mfaPending };
  const invalidCode = () => NextResponse.json({ error: "invalid two-factor code" }, { status: 401 });
  let token: string | null;
  if (row.totp_enabled) {
    if (!totp && !recoveryCode) {
      return NextResponse.json(
        { error: "two-factor code required", two_factor_required: true },
        { status: 401 },
      );
    }
    if (totp) {
      if (!row.totp_secret || !verifyTotp(row.totp_secret, totp)) return invalidCode();
      token = await createSession(row.id, sessionOptions);
    } else {
      token = await withTransaction(async (q) => {
        if (!(await consumeRecoveryCodeForUser(q, row.id, recoveryCode))) return null;
        return createSession(row.id, sessionOptions, q);
      });
    }
  } else {
    token = await createSession(row.id, sessionOptions);
  }
  if (!token) return invalidCode();

  const res = NextResponse.json({
    id: row.id,
    name: row.name,
    two_factor_setup_required: mfaPending,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  // Remove the legacy numeric demo cookie if it is still present.
  res.cookies.set("atlas_uid", "", { path: "/", maxAge: 0 });
  return res;
}
