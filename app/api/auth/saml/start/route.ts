import { guardAuthRequest, reserveAuthAttempt, authRateLimitResponse, POLICIES } from "@/lib/auth-rate-limit";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { allowsSamlFlowCookie, appOrigin, buildSaml, SAML_FLOW_COOKIE_OPTIONS, samlFlowCookieName } from "@/lib/saml";
import { generateSessionToken } from "@/lib/session-token";

async function startSaml(req: Request) {
  const settings = await getSecuritySettings();
  const origin = appOrigin(req);
  if (settings.saml_mode === "off") {
    return NextResponse.redirect(new URL("/login?saml=disabled", origin));
  }
  try {
    if (!allowsSamlFlowCookie(origin)) return NextResponse.redirect(new URL("/login?saml=error", origin));
    const flow = { state: generateSessionToken(), secret: generateSessionToken() };
    const saml = buildSaml(req, settings, flow);
    const url = await saml.getAuthorizeUrlAsync(flow.state, {});
    const res = NextResponse.redirect(url);
    res.headers.set("Cache-Control", "no-store");
    res.cookies.set(samlFlowCookieName(flow.state), flow.secret, SAML_FLOW_COOKIE_OPTIONS);
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?saml=error", origin));
  }
}

export async function GET(req: Request) {
  try {
    await guardAuthRequest(req, "saml-start");
    await reserveAuthAttempt("saml-start", verifiedAuthClientIp(req) ?? "unattributed", POLICIES["saml-start"]);
    return await startSaml(req);
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) return limited;
    throw error;
  }
}
