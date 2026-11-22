// NGINX keeps an idle upstream connection for 60s by default (stable 1.30.x and
// mainline 1.31.x alike). Node must hold its side open longer than that, or
// NGINX can hand a request to a socket Node is already closing and return 502.
export const DEFAULT_KEEPALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_HEADROOM_MS = 5_000;
const MAX_KEEPALIVE_TIMEOUT_MS = 3_600_000;

/** Invalid or empty values fall back to the production default. */
export function resolveKeepAliveTimeout(value) {
  if (value === undefined || value === null) return DEFAULT_KEEPALIVE_TIMEOUT_MS;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return DEFAULT_KEEPALIVE_TIMEOUT_MS;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_KEEPALIVE_TIMEOUT_MS) {
    return DEFAULT_KEEPALIVE_TIMEOUT_MS;
  }
  return parsed;
}

/** headersTimeout must stay above keepAliveTimeout for Node's socket guards. */
export function keepAliveTimeouts(value) {
  const keepAliveTimeout = resolveKeepAliveTimeout(value);
  return {
    keepAliveTimeout,
    headersTimeout: keepAliveTimeout + HEADERS_TIMEOUT_HEADROOM_MS,
  };
}
