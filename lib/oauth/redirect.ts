export type OAuthApplicationType = "native" | "web";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

type ParsedRedirect = { url: URL; loopback: boolean };

function parse(raw: string): ParsedRedirect | null {
  if (typeof raw !== "string" || raw === "" || raw.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return { url, loopback: LOOPBACK_HOSTS.has(hostname) };
}

/** Loopback redirect URI: http(s) on 127.0.0.1, [::1] or localhost. */
export function isLoopbackRedirectUri(raw: string): boolean {
  return parse(raw)?.loopback === true;
}

/**
 * General redirect URI rule (RFC 8252): https anywhere, or http only on a
 * loopback host. Fragments and userinfo are never allowed.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  const parsed = parse(raw);
  if (!parsed) return false;
  return parsed.url.protocol === "https:" || parsed.loopback;
}

/** `native` clients may only use loopback redirects; `web` clients need https. */
export function isValidRedirectForApplication(
  raw: string,
  applicationType: OAuthApplicationType,
): boolean {
  const parsed = parse(raw);
  if (!parsed) return false;
  if (applicationType === "web") return parsed.url.protocol === "https:";
  return parsed.loopback;
}

/**
 * Match a requested redirect_uri against a registered value.
 *
 * Non-loopback URIs must match exactly. Loopback URIs ignore the port, as
 * RFC 8252 §7.3 requires, but still compare scheme, host, path and query.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (!isAllowedRedirectUri(registered) || !isAllowedRedirectUri(requested)) return false;
  const expected = parse(registered);
  const actual = parse(requested);
  if (!expected || !actual) return false;
  if (!expected.loopback || !actual.loopback) {
    return registered === requested;
  }
  return expected.url.protocol === actual.url.protocol
    && expected.url.hostname.toLowerCase() === actual.url.hostname.toLowerCase()
    && expected.url.pathname === actual.url.pathname
    && expected.url.search === actual.url.search;
}
