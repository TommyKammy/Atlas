import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db, withTransaction } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { ApiError, conflict, forbidden, jsonError, notFound, unauthorized } from "@/lib/api/errors";
import { consumeRecoveryCodeForUser } from "@/lib/api/mfa";
import { getMfaRequestSession, lockSessionPolicy, rotateSessionAfterMfa, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { getSecuritySettings } from "@/lib/admin-data";
import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";
import { SamlSessionRequiredError } from "@/lib/session-policy";
import { decryptMfaSecret, encryptMfaSecret, MfaSecretUnavailableError } from "@/lib/mfa-secret";
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

export async function GET(req: Request) {
  try {
    const access = await getMfaRequestSession(req);
    if (!access) throw notFound();
    const me = await loadMe(access.user.id);
    if (!me) throw notFound();
    const security = await getSecuritySettings();
    return NextResponse.json({
      enabled: me.totp_enabled === true,
      enrolled_at: me.totp_enrolled_at,
      recovery_codes_remaining: Array.isArray(me.totp_recovery_codes)
        ? me.totp_recovery_codes.length
        : 0,
      policy: security.two_factor_policy,
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function updateMfa(req: Request) {
  await guardAuthRequest(req, "mfa");
  const access = await getMfaRequestSession(req);
  if (!access) throw notFound();
  const uid = access.user.id;
  const me = await loadMe(uid);
  if (!me) throw notFound();
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  if (!["begin", "enable", "disable", "verify"].includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  const scope = action === "verify" ? "mfa-verify" : action === "begin" ? "mfa-enroll" : "mfa-manage";
  const attempt = await reserveAuthAttempt(scope, String(uid), POLICIES[scope]);
  try {
    return await applyMfa(access, me, body, action, attempt);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) await attempt.release();
    throw error;
  }
}

async function applyMfa(
  access: NonNullable<Awaited<ReturnType<typeof getMfaRequestSession>>>,
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  body: Record<string, unknown> | null,
  action: string,
  attempt: Awaited<ReturnType<typeof reserveAuthAttempt>>,
) {
  const uid = access.user.id;

  if (action === "verify") {
    if (!access.mfaPending || !me.totp_enabled) throw forbidden("two-factor verification unavailable");
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const recoveryCode = typeof body?.recovery_code === "string" ? body.recovery_code.trim() : "";
    const session = await withTransaction(async (q) => {
      await lockSessionPolicy(q);
      const current = await q.query(
        "SELECT totp_secret FROM users WHERE id = $1 AND totp_enabled AND deactivated_at IS NULL FOR UPDATE",
        [uid],
      );
      if (current.rowCount !== 1) throw unauthorized("invalid two-factor code");
      const secret = current.rows[0].totp_secret as string | null;
      const verified = code ? !!secret && verifyTotp(decryptMfaSecret(secret, uid, "active"), code)
        : !!recoveryCode && await consumeRecoveryCodeForUser(q, uid, recoveryCode);
      if (!verified) throw unauthorized("invalid two-factor code");
      const rotated = await rotateSessionAfterMfa(q, access);
      if (!rotated) throw unauthorized();
      await attempt.release(q);
      return rotated;
    });
    const res = NextResponse.json({ enabled: true });
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.maxAge));
    return res;
  }

  if (action === "begin") {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, uid, "pending");
    const updated = await db.query(
      "UPDATE users SET totp_pending_secret = $2 WHERE id = $1 AND NOT totp_enabled AND deactivated_at IS NULL",
      [uid, encrypted],
    );
    if (updated.rowCount !== 1) throw conflict("two-factor authentication is already enabled");
    const issuer = me.workspace_name || "Atlas";
    const uri = otpauthUrl(secret, me.email ?? me.name, issuer);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauth_uri: uri, qr_data_url: qrDataUrl }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "enable") {
    if (me.totp_enabled) throw conflict("two-factor authentication is already enabled");
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const pendingSecret = me.totp_pending_secret ? decryptMfaSecret(me.totp_pending_secret, uid, "pending") : null;
    if (!pendingSecret || !verifyTotp(pendingSecret, code)) {
      return NextResponse.json({ error: "invalid verification code" }, { status: 400 });
    }
    const recoveryCodes = generateRecoveryCodes();
    const session = await withTransaction(async (q) => {
      await lockSessionPolicy(q);
      const updated = await q.query(
        `UPDATE users SET totp_secret = $2, totp_pending_secret = NULL, totp_enabled = TRUE,
           totp_recovery_codes = $3, totp_enrolled_at = now()
         WHERE id = $1 AND totp_pending_secret = $4 AND NOT totp_enabled AND deactivated_at IS NULL`,
        [uid, encryptMfaSecret(pendingSecret, uid, "active"), recoveryCodes.map(hashRecoveryCode), me.totp_pending_secret],
      );
      if (updated.rowCount !== 1) throw conflict("two-factor setup changed; start again");
      const rotated = await rotateSessionAfterMfa(q, access);
      if (!rotated) throw unauthorized();
      await attempt.release(q);
      return rotated;
    });
    const res = NextResponse.json({ enabled: true, recovery_codes: recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.maxAge));
    return res;
  }

  if (access.mfaPending) throw forbidden("two-factor setup or verification required");

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
    await attempt.release();
    await db.query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_pending_secret = NULL,
         totp_recovery_codes = '{}', totp_enrolled_at = NULL
       WHERE id = $1`,
      [uid],
    );
    return NextResponse.json({ enabled: false });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const response = await updateMfa(req);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof SamlSessionRequiredError) return NextResponse.json({ error: "SAML SSO is required", saml_required: true }, { status: 403 });
    if (error instanceof MfaSecretUnavailableError) return NextResponse.json({
      error: "two-factor authentication is temporarily unavailable", code: "mfa_unavailable",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return jsonError(error);
  }
}
