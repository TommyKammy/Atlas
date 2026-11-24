import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSession, lockSessionPolicy, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { consumeRecoveryCodeForUser } from "@/lib/api/mfa";
import { verifyTotp } from "@/lib/totp";
import { requiresSaml } from "@/lib/admin-data";
import { decryptMfaSecret, MfaSecretUnavailableError } from "@/lib/mfa-secret";
import { SamlSessionRequiredError } from "@/lib/session-policy";
import { POST_LOGIN_COOKIE, postLoginCookieOptions, postLoginPathFromCookieHeader } from "@/lib/post-login";
import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";

function samlRequired() {
  return NextResponse.json({ error: "SAML SSO is required for this workspace", saml_required: true,
    saml_start: "/api/auth/saml/start" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

async function login(req: Request) {
  await guardAuthRequest(req, "login");
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const totp = typeof body?.totp === "string" ? body.totp.trim() : "";
  const recoveryCode = typeof body?.recovery_code === "string" ? body.recovery_code.trim() : "";
  if (!email || !password || email.length > 320) return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  const attempt = await reserveAuthAttempt("login-account", email, POLICIES["login-account"]);
  try {
    const r = await db.query(`SELECT u.id,u.name,u.password_hash,u.deactivated_at,u.is_admin,u.is_guest,
        r.base_level,u.totp_enabled,u.totp_secret
      FROM users u LEFT JOIN workspace_roles r ON r.id=u.role_id WHERE u.email=$1`, [email]);
    const row = r.rows[0] as { id: number; name: string; password_hash: string | null;
      deactivated_at: string | null; is_admin: boolean; is_guest: boolean; base_level: string | null;
      totp_enabled: boolean; totp_secret: string | null } | undefined;
    if (row?.deactivated_at) return NextResponse.json({ error: "account is deactivated" }, { status: 403 });
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }
    // A valid first factor does not consume the password-failure allowance.
    // OTP/recovery attempts have their own shared per-user allowance.
    await attempt.release();
    const mfa = totp || recoveryCode ? await reserveAuthAttempt("mfa-verify", String(row.id), POLICIES["mfa-verify"]) : null;
    let outcome;
    try {
      outcome = await withTransaction(async (q) => {
        // The final decision must use current MFA/password state, including
        // enrollment or resets that completed while the first factor was checked.
        await lockSessionPolicy(q);
        const current = await q.query(`SELECT u.id,u.name,u.password_hash,u.is_admin,u.is_guest,
            r.base_level,u.totp_enabled,u.totp_secret
          FROM users u LEFT JOIN workspace_roles r ON r.id=u.role_id
          WHERE u.id=$1 AND u.deactivated_at IS NULL FOR UPDATE OF u`, [row.id]);
        const live = current.rows[0] as typeof row | undefined;
        if (!live || live.password_hash !== row.password_hash) return { kind: "credentials" as const };
        const policy = await q.query(`SELECT saml_mode,two_factor_policy FROM workspace_security
          WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1)`);
        const security = policy.rows[0] as { saml_mode: "off" | "optional" | "required" | "members_only"; two_factor_policy: string } | undefined;
        if (security && requiresSaml(security.saml_mode, live)) return { kind: "saml" as const };
        const mfaPending = security?.two_factor_policy === "required" && !live.totp_enabled;
        if (live.totp_enabled) {
          if (!mfa) return { kind: "challenge" as const };
          const verified = totp ? !!live.totp_secret && verifyTotp(decryptMfaSecret(live.totp_secret, live.id, "active"), totp)
            : await consumeRecoveryCodeForUser(q, live.id, recoveryCode);
          if (!verified) return { kind: "invalid" as const };
        }
        const token = await createSession(live.id, { userAgent: req.headers.get("user-agent"), mfaPending }, q);
        if (mfa) await mfa.release(q);
        return { kind: "session" as const, token, name: live.name, mfaPending };
      });
    } catch (error) {
      if (mfa) await mfa.release();
      throw error;
    }
    if (outcome.kind === "saml") { if (mfa) await mfa.release(); return samlRequired(); }
    if (outcome.kind === "challenge") return NextResponse.json({ error: "two-factor code required", two_factor_required: true }, { status: 401 });
    if (outcome.kind === "credentials") { if (mfa) await mfa.release(); return NextResponse.json({ error: "invalid credentials" }, { status: 401 }); }
    if (outcome.kind === "invalid") return NextResponse.json({ error: "invalid two-factor code" }, { status: 401 });
    const redirectTo = outcome.mfaPending
      ? null
      : postLoginPathFromCookieHeader(req.headers.get("cookie"));
    const res = NextResponse.json({
      id: row.id,
      name: outcome.name,
      two_factor_setup_required: outcome.mfaPending,
      ...(redirectTo === null ? {} : { redirect_to: redirectTo }),
    }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, outcome.token, sessionCookieOptions());
    res.cookies.set("atlas_uid", "", { path: "/", maxAge: 0 });
    if (!outcome.mfaPending) {
      // Consumed (or stale) once the session is established. MFA keeps it for
      // the verification request after the profile page completes MFA.
      res.cookies.set(POST_LOGIN_COOKIE, "", { ...postLoginCookieOptions(), maxAge: 0 });
    }
    return res;
  } catch (error) {
    await attempt.release();
    throw error;
  }
}

export async function POST(req: Request) {
  try { return await login(req); } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof SamlSessionRequiredError) return samlRequired();
    if (error instanceof MfaSecretUnavailableError) return NextResponse.json({
      error: "two-factor authentication is temporarily unavailable", code: "mfa_unavailable",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "authentication temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
