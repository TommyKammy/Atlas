import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { allowsSamlFlowCookie, appOrigin, buildSaml, SAML_FLOW_COOKIE_OPTIONS, samlFlowCookieName } from "@/lib/saml";
import { generateSessionToken } from "@/lib/session-token";

export async function GET(req: Request) {
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
