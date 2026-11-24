import { sessionCookieSecure } from "./cookie-security";

export const POST_LOGIN_COOKIE = "atlas_post_login";
export const POST_LOGIN_TTL_SECONDS = 10 * 60;
export const POST_LOGIN_PATH = "/oauth/authorize";
const MAX_PATH_LENGTH = 2048;
const INVALID_BASE = "https://atlas.invalid";

/**
 * Accept only the Atlas authorization page as a post-login destination.
 *
 * The value must be a same-origin absolute path whose pathname is exactly
 * /oauth/authorize. Protocol-relative values such as //evil.example, absolute
 * URLs, traversal that escapes the path, fragments and other Atlas pages are
 * rejected. The caller still validates again before navigating.
 */
export function safePostLoginPath(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value.length > MAX_PATH_LENGTH) {
    return null;
  }
  if (value !== POST_LOGIN_PATH && !value.startsWith(`${POST_LOGIN_PATH}?`)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, INVALID_BASE);
  } catch {
    return null;
  }
  if (url.origin !== INVALID_BASE || url.pathname !== POST_LOGIN_PATH || url.hash !== "") {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

/** Cookie attributes for the short-lived post-login destination. */
export function postLoginCookieOptions() {
  return {
    path: "/",
    maxAge: POST_LOGIN_TTL_SECONDS,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: sessionCookieSecure(),
  };
}

/** Serialize the Set-Cookie value for plain Response objects. */
export function postLoginCookieHeader(path: string): string {
  const options = postLoginCookieOptions();
  return `${POST_LOGIN_COOKIE}=${encodeURIComponent(path)}; Path=${options.path}; `
    + `Max-Age=${options.maxAge}; HttpOnly; SameSite=Lax`
    + (options.secure ? "; Secure" : "");
}

/**
 * Read the destination from a raw Cookie header. Next serializes cookie values
 * with encodeURIComponent, so decode it before validating.
 */
export function postLoginPathFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)atlas_post_login=([^;]*)/);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return safePostLoginPath(decoded);
}
