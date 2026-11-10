import { SAML, ValidateInResponseTo, type CacheProvider } from "@node-saml/node-saml";
import { createHash } from "node:crypto";
import type { SecuritySettings } from "./admin-data";
import { db, type Queryable } from "./db";

const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

type SamlBrowserFlow = { state: string; secret: string };

export const SAML_FLOW_COOKIE_OPTIONS = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "none",
  maxAge: SAML_REQUEST_TTL_MS / 1000,
} as const;

export function samlFlowCookieName(state: string): string {
  return `__Host-atlas_saml_${state}`;
}

export function allowsSamlFlowCookie(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" ||
      (protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
  } catch {
    return false;
  }
}

function samlCache(workspaceId: number, flow: SamlBrowserFlow, q: Queryable): CacheProvider {
  function requestKey(requestId: string) {
    // The IdP sees RelayState. Only this browser holds the independent secret.
    return "request:" + createHash("sha256").update(JSON.stringify([requestId, flow.state, flow.secret])).digest("hex");
  }

  async function saveIfAbsentAsync(key: string, value: string, expiresAtMs: number) {
    const result = await q.query(
      `INSERT INTO saml_cache (workspace_id, cache_key, value, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000))
       ON CONFLICT (workspace_id, cache_key) DO UPDATE
       SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
       WHERE saml_cache.expires_at <= now()`,
      [workspaceId, key, value, expiresAtMs],
    );
    return result.rowCount === 1;
  }

  async function consumeAsync(key: string) {
    const result = await q.query(
      `DELETE FROM saml_cache WHERE workspace_id = $1 AND cache_key = $2 AND expires_at > now()
       RETURNING value`,
      [workspaceId, requestKey(key)],
    );
    return (result.rows[0]?.value as string | undefined) ?? null;
  }

  return {
    async saveAsync(key, value) {
      await q.query("DELETE FROM saml_cache WHERE expires_at <= now()").catch(() => undefined);
      const createdAt = Date.now();
      return await saveIfAbsentAsync(requestKey(key), value, createdAt + SAML_REQUEST_TTL_MS)
        ? { value, createdAt }
        : null;
    },
    async getAsync(key) {
      const result = await q.query(
        "SELECT value FROM saml_cache WHERE workspace_id = $1 AND cache_key = $2 AND expires_at > now()",
        [workspaceId, requestKey(key)],
      );
      return (result.rows[0]?.value as string | undefined) ?? null;
    },
    removeAsync: (key) => key === null ? Promise.resolve(null) : consumeAsync(key),
    consumeAsync,
    // Assertion replay records must be shared across browser flows.
    saveIfAbsentAsync,
  };
}

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

export function buildSaml(req: Request, settings: SecuritySettings, flow: SamlBrowserFlow, q: Queryable = db): SAML {
  const origin = appOrigin(req);
  return new SAML({
    callbackUrl: `${origin}/api/auth/saml/callback`,
    entryPoint: settings.saml_signin_url,
    issuer: samlIssuer(settings),
    idpCert: settings.saml_certificate,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    rejectReplayedAssertions: true,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    maxAssertionAgeMs: 5 * 60 * 1000,
    cacheProvider: samlCache(settings.workspace_id, flow, q),
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
