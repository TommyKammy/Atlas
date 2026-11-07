import { generateServiceProviderMetadata } from "@node-saml/node-saml";
import { getSecuritySettings } from "@/lib/admin-data";
import { appOrigin, samlIssuer } from "@/lib/saml";

export async function GET(req: Request) {
  const settings = await getSecuritySettings();
  const metadata = generateServiceProviderMetadata({
    issuer: samlIssuer(settings),
    callbackUrl: `${appOrigin(req)}/api/auth/saml/callback`,
    wantAssertionsSigned: true,
  });
  return new Response(metadata, {
    headers: { "Content-Type": "application/samlmetadata+xml; charset=utf-8" },
  });
}
