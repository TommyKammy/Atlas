import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/current-user";
import { consumeRecoveryCode, verifyTotp } from "@/lib/totp";
import { getSecuritySettings } from "@/lib/admin-data";

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
       totp_enabled, totp_secret, totp_recovery_codes
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
        totp_recovery_codes: string[] | null;
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
  const samlRequired =
    security.saml_mode === "required" ||
    (security.saml_mode === "members_only" && !row.is_guest);
  if (samlRequired && !row.is_admin) {
    return NextResponse.json(
      {
        error: "SAML SSO is required for this workspace",
        saml_required: true,
        saml_start: "/api/auth/saml/start",
      },
      { status: 403 },
    );
  }

  if (row.totp_enabled) {
    if (!totp && !recoveryCode) {
      return NextResponse.json(
        { error: "two-factor code required", two_factor_required: true },
        { status: 401 },
      );
    }
    let verified = false;
    if (totp) {
      verified = row.totp_secret ? verifyTotp(row.totp_secret, totp) : false;
    } else if (recoveryCode) {
      const consumed = consumeRecoveryCode(recoveryCode, row.totp_recovery_codes);
      if (consumed.ok) {
        verified = true;
        await db.query("UPDATE users SET totp_recovery_codes = $2 WHERE id = $1", [
          row.id,
          consumed.remaining,
        ]);
      }
    }
    if (!verified) {
      return NextResponse.json({ error: "invalid two-factor code" }, { status: 401 });
    }
  }

  const res = NextResponse.json({
    id: row.id,
    name: row.name,
    two_factor_setup_required: security.two_factor_policy === "required" && !row.totp_enabled,
  });
  res.cookies.set(COOKIE_NAME, String(row.id), {
    path: "/",
    maxAge: 7 * 24 * 3600,
    sameSite: "lax",
    httpOnly: true,
  });
  return res;
}
