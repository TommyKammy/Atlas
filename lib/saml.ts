import { SAML } from "@node-saml/node-saml";
import type { SecuritySettings } from "./admin-data";

export function appOrigin(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}

export function samlIssuer(settings: SecuritySettings): string {
  return `atlas-sp-${settings.workspace_id}`;
}

export function buildSaml(req: Request, settings: SecuritySettings): SAML {
  const origin = appOrigin(req);
  return new SAML({
    callbackUrl: `${origin}/api/auth/saml/callback`,
    entryPoint: settings.saml_signin_url,
    issuer: samlIssuer(settings),
    idpCert: settings.saml_certificate,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 5000,
    audience: samlIssuer(settings),
  });
}

export function samlProfileEmail(profile: Record<string, unknown>): string | null {
  const candidates = [
    profile.email,
    profile.mail,
    profile["urn:oid:0.9.2342.19200300.100.1.3"],
    profile.nameID,
    profile.NameID,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

export function samlProfileName(profile: Record<string, unknown>, email: string): string {
  const candidates = [
    profile.displayName,
    profile.cn,
    profile["urn:oid:2.5.4.3"],
    profile["urn:oid:2.16.840.1.113730.3.1.241"],
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 120);
  }
  return email.split("@")[0].slice(0, 120);
}
