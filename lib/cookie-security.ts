type Environment = Record<string, string | undefined>;

/**
 * Whether cookies must carry the Secure attribute. The explicit switch wins;
 * otherwise an https APP_URL / APP_ORIGIN (the public deployment origin)
 * enables Secure. Shared by the session and post-login cookies so they always
 * agree.
 */
export function sessionCookieSecure(env: Environment = process.env): boolean {
  return env.SESSION_COOKIE_SECURE === "1"
    || env.APP_URL?.startsWith("https://") === true
    || env.APP_ORIGIN?.startsWith("https://") === true;
}
