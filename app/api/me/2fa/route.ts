import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { withUser } from "@/lib/api/route";
import { getSecuritySettings } from "@/lib/admin-data";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "@/lib/totp";

async function loadMe(uid: number) {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.password_hash, u.totp_enabled, u.totp_secret,
       u.totp_pending_secret, u.totp_recovery_codes, u.totp_enrolled_at::text AS totp_enrolled_at,
       w.name AS workspace_name
     FROM users u LEFT JOIN workspaces w ON TRUE
     WHERE u.id = $1 AND u.deactivated_at IS NULL
     ORDER BY w.id LIMIT 1`,
    [uid],
  );
  return r.rows[0] as
    | {
        id: number;
        name: string;
        email: string | null;
        password_hash: string | null;
        totp_enabled: boolean;
        totp_secret: string | null;
        totp_pending_secret: string | null;
        totp_recovery_codes: string[] | null;
        totp_enrolled_at: string | null;
        workspace_name: string | null;
      }
    | undefined;
}

export const GET = withUser(async (_req, { uid }) => {
  const me = await loadMe(uid);
  if (!me) return NextResponse.json({ error: "not found" }, { status: 404 });
  const security = await getSecuritySettings();
  return NextResponse.json({
    enabled: me.totp_enabled === true,
    enrolled_at: me.totp_enrolled_at,
    recovery_codes_remaining: Array.isArray(me.totp_recovery_codes)
      ? me.totp_recovery_codes.length
      : 0,
    policy: security.two_factor_policy,
  });
});

export const POST = withUser(async (req, { uid }) => {
  const me = await loadMe(uid);
  if (!me) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "begin") {
    const secret = generateTotpSecret();
    await db.query("UPDATE users SET totp_pending_secret = $2 WHERE id = $1", [uid, secret]);
    const issuer = me.workspace_name || "Atlas";
    const uri = otpauthUrl(secret, me.email ?? me.name, issuer);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauth_uri: uri, qr_data_url: qrDataUrl });
  }

  if (action === "enable") {
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!me.totp_pending_secret || !verifyTotp(me.totp_pending_secret, code)) {
      return NextResponse.json({ error: "invalid verification code" }, { status: 400 });
    }
    const recoveryCodes = generateRecoveryCodes();
    await db.query(
      `UPDATE users SET totp_secret = $2, totp_pending_secret = NULL, totp_enabled = TRUE,
         totp_recovery_codes = $3, totp_enrolled_at = now()
       WHERE id = $1`,
      [uid, me.totp_pending_secret, recoveryCodes.map(hashRecoveryCode)],
    );
    return NextResponse.json({ enabled: true, recovery_codes: recoveryCodes });
  }

  if (action === "disable") {
    const security = await getSecuritySettings();
    if (security.two_factor_policy === "required") {
      return NextResponse.json(
        { error: "two-factor authentication is required by workspace policy" },
        { status: 400 },
      );
    }
    const password = typeof body?.password === "string" ? body.password : "";
    if (!me.password_hash || !verifyPassword(password, me.password_hash)) {
      return NextResponse.json({ error: "password mismatch" }, { status: 401 });
    }
    await db.query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_pending_secret = NULL,
         totp_recovery_codes = '{}', totp_enrolled_at = NULL
       WHERE id = $1`,
      [uid],
    );
    return NextResponse.json({ enabled: false });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}, { inactiveStatus: 404 });
