import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { appOrigin, buildSaml } from "@/lib/saml";

export async function GET(req: Request) {
  const settings = await getSecuritySettings();
  if (settings.saml_mode === "off") {
    return NextResponse.redirect(new URL("/login?saml=disabled", appOrigin(req)));
  }
  const saml = buildSaml(req, settings);
  try {
    const url = await saml.getAuthorizeUrlAsync("", {});
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/login?saml=error", appOrigin(req)));
  }
}
