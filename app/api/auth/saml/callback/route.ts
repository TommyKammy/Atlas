import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import { NextResponse, type NextRequest } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { createSession, lockSessionPolicy, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { getSecuritySettings } from "@/lib/admin-data";
import {
  allowsSamlFlowCookie, appOrigin, buildSaml, decodeSamlFlowProof,
  SAML_FLOW_COOKIE_OPTIONS, samlFlowCookieName,
  samlProfileEmail, samlProfileName,
} from "@/lib/saml";
import { getDefaultRole } from "@/lib/permissions";
import { shouldProvisionSamlUser } from "@/lib/saml-provisioning";
import { POST_LOGIN_COOKIE, postLoginCookieOptions, postLoginPathFromCookieHeader } from "@/lib/post-login";
import { isSessionToken } from "@/lib/session-token";

function redirectAfterPost(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

function loginError(code: string) {
  return redirectAfterPost(`/login?saml_error=${encodeURIComponent(code)}`);
}

async function finishSaml(req: NextRequest) {
  const settings = await getSecuritySettings();
  if (settings.saml_mode === "off") return loginError("disabled");
  if (!allowsSamlFlowCookie(appOrigin(req))) return loginError("invalid_state");
  const form = await req.formData().catch(() => null);
  const response = form?.get("SAMLResponse");
  if (typeof response !== "string" || response === "") return loginError("missing_response");
  const state = form?.get("RelayState");
  if (!isSessionToken(state)) return loginError("invalid_state");
  const flowCookie = samlFlowCookieName(state);
  const proofValue = req.cookies.get(flowCookie)?.value;
  const proof = typeof proofValue === "string" ? decodeSamlFlowProof(proofValue) : null;
  if (!proof) return loginError("invalid_state");

  let profile: Record<string, unknown>;
  try {
    // The SDK records the assertion before checking its signed request ID.
    // Roll back that record if validation fails so another flow cannot burn it.
    const result = await withTransaction((q) =>
      buildSaml(req, settings, { state, secret: proof.secret }, q).validatePostResponseAsync({ SAMLResponse: response }),
    );
    if (!result.profile) return loginError("invalid_response");
    profile = result.profile as unknown as Record<string, unknown>;
  } catch {
    return loginError("invalid_signature");
  }

  const email = samlProfileEmail(profile);
  if (!email) return loginError("missing_email");

  const found = await db.query(
    "SELECT id, deactivated_at, totp_enabled FROM users WHERE email = $1",
    [email],
  );
  type SamlUser = { id: number; deactivated_at: string | null; totp_enabled: boolean };
  let user = found.rows[0] as SamlUser | undefined;
  if (user?.deactivated_at) return loginError("deactivated");

  if (!user) {
    if (!shouldProvisionSamlUser(settings)) return loginError("user_not_found");
    const role = await getDefaultRole();
    if (!role) return loginError("no_default_role");
    const created = await db.query(
      `INSERT INTO users (name, email, is_guest, is_admin, role_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, deactivated_at, totp_enabled`,
      [samlProfileName(profile, email), email, role.isGuest, role.isAdmin, role.id],
    );
    if (created.rowCount === 0) return loginError("user_conflict");
    user = created.rows[0] as SamlUser;
  }

  const userId = user.id;
  const issued = await withTransaction(async (q) => {
    await lockSessionPolicy(q);
    // MFA may have been enrolled/reset while the assertion was validated.
    // Re-read under the same user lock that protects final credential issuance.
    const latest = await q.query("SELECT deactivated_at,totp_enabled FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!latest.rows[0] || latest.rows[0].deactivated_at) return { ok: false, error: "deactivated" } as const;
    const policy = await q.query("SELECT saml_mode,saml_session_days,two_factor_policy FROM workspace_security WHERE workspace_id=$1", [settings.workspace_id]);
    if (!policy.rows[0] || policy.rows[0].saml_mode === "off") return { ok: false, error: "disabled" } as const;
    const maxAge = Number(policy.rows[0].saml_session_days) * 24 * 3600;
    const mfaPending = latest.rows[0].totp_enabled || policy.rows[0].two_factor_policy === "required";
    const token = await createSession(userId, { userAgent: req.headers.get("user-agent"), maxAge, mfaPending, authMethod: "saml" }, q);
    return { ok: true, token, maxAge, mfaPending } as const;
  });
  if (!issued.ok) return loginError(issued.error);
  const returnTo = issued.mfaPending
    ? null
    : (proof.returnTo ?? postLoginPathFromCookieHeader(req.headers.get("cookie")));
  const res = redirectAfterPost(
    issued.mfaPending ? "/profile#two-factor" : (returnTo ?? "/"),
  );
  res.cookies.set(SESSION_COOKIE, issued.token, sessionCookieOptions(issued.maxAge));
  res.cookies.set(flowCookie, "", { ...SAML_FLOW_COOKIE_OPTIONS, maxAge: 0 });
  if (issued.mfaPending && proof.returnTo !== undefined) {
    // The flow cookie is removed above; carry the destination into the
    // same-site MFA verification request.
    res.cookies.set(POST_LOGIN_COOKIE, proof.returnTo, postLoginCookieOptions());
  } else if (!issued.mfaPending) {
    res.cookies.set(POST_LOGIN_COOKIE, "", { ...postLoginCookieOptions(), maxAge: 0 });
  }
  return res;
}

export async function POST(req: NextRequest) {
  try {
    await guardAuthRequest(req, "saml-callback");
    await reserveAuthAttempt("saml-callback", verifiedAuthClientIp(req) ?? "unattributed", POLICIES["saml-callback"]);
    return await finishSaml(req);
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    throw error;
  }
}
