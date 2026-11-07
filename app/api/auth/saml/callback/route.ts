import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { COOKIE_NAME } from "@/lib/current-user";
import { getSecuritySettings } from "@/lib/admin-data";
import { appOrigin, buildSaml, samlProfileEmail, samlProfileName } from "@/lib/saml";
import { getDefaultRole } from "@/lib/permissions";

function loginError(req: Request, code: string) {
  return NextResponse.redirect(
    new URL(`/login?saml_error=${encodeURIComponent(code)}`, appOrigin(req)),
  );
}

export async function POST(req: Request) {
  const settings = await getSecuritySettings();
  if (settings.saml_mode === "off") return loginError(req, "disabled");
  const form = await req.formData().catch(() => null);
  const response = form?.get("SAMLResponse");
  if (typeof response !== "string" || response === "") return loginError(req, "missing_response");

  const saml = buildSaml(req, settings);
  let profile: Record<string, unknown>;
  try {
    const result = await saml.validatePostResponseAsync({ SAMLResponse: response });
    if (!result.profile) return loginError(req, "invalid_response");
    profile = result.profile as unknown as Record<string, unknown>;
  } catch {
    return loginError(req, "invalid_signature");
  }

  const email = samlProfileEmail(profile);
  if (!email) return loginError(req, "missing_email");

  const found = await db.query(
    "SELECT id, name, deactivated_at FROM users WHERE email = $1",
    [email],
  );
  let user = found.rows[0] as { id: number; name: string; deactivated_at: string | null } | undefined;
  if (user?.deactivated_at) return loginError(req, "deactivated");

  if (!user) {
    if (!settings.saml_jit_provisioning) return loginError(req, "user_not_found");
    const role = await getDefaultRole();
    if (!role) return loginError(req, "no_default_role");
    const created = await db.query(
      `INSERT INTO users (name, email, is_guest, is_admin, role_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name`,
      [samlProfileName(profile, email), email, role.isGuest, role.isAdmin, role.id],
    );
    if (created.rowCount === 0) return loginError(req, "user_conflict");
    user = created.rows[0] as { id: number; name: string; deactivated_at: string | null };
  }

  const res = NextResponse.redirect(new URL("/", appOrigin(req)));
  res.cookies.set(COOKIE_NAME, String(user.id), {
    path: "/",
    maxAge: Math.max(1, Number(settings.saml_session_days) || 7) * 24 * 3600,
    sameSite: "lax",
    httpOnly: true,
  });
  return res;
}
