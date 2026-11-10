import { NextResponse, type NextRequest } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/api/session";
import { getSecuritySettings } from "@/lib/admin-data";
import {
  allowsSamlFlowCookie, appOrigin, buildSaml, SAML_FLOW_COOKIE_OPTIONS, samlFlowCookieName,
  samlProfileEmail, samlProfileName,
} from "@/lib/saml";
import { getDefaultRole } from "@/lib/permissions";
import { isSessionToken } from "@/lib/session-token";

function redirectAfterPost(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

function loginError(code: string) {
  return redirectAfterPost(`/login?saml_error=${encodeURIComponent(code)}`);
}

export async function POST(req: NextRequest) {
  const settings = await getSecuritySettings();
  if (settings.saml_mode === "off") return loginError("disabled");
  if (!allowsSamlFlowCookie(appOrigin(req))) return loginError("invalid_state");
  const form = await req.formData().catch(() => null);
  const response = form?.get("SAMLResponse");
  if (typeof response !== "string" || response === "") return loginError("missing_response");
  const state = form?.get("RelayState");
  if (!isSessionToken(state)) return loginError("invalid_state");
  const flowCookie = samlFlowCookieName(state);
  const secret = req.cookies.get(flowCookie)?.value;
  if (!isSessionToken(secret)) return loginError("invalid_state");

  let profile: Record<string, unknown>;
  try {
    // The SDK records the assertion before checking its signed request ID.
    // Roll back that record if validation fails so another flow cannot burn it.
    const result = await withTransaction((q) =>
      buildSaml(req, settings, { state, secret }, q).validatePostResponseAsync({ SAMLResponse: response }),
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
    if (!settings.saml_jit_provisioning) return loginError("user_not_found");
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

  const maxAge = settings.saml_session_days * 24 * 3600;
  const mfaPending = user.totp_enabled || settings.two_factor_policy === "required";
  const token = await createSession(user.id, { userAgent: req.headers.get("user-agent"), maxAge, mfaPending });
  const res = redirectAfterPost(mfaPending ? "/profile#two-factor" : "/");
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  res.cookies.set(flowCookie, "", { ...SAML_FLOW_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
