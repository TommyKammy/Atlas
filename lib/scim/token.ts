import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCIM_TOKEN_PREFIX = "atlas_scim_";
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

/** "atlas_scim_" + 32 random bytes as base64url. */
export function generateScimToken(): string {
  return `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isScimToken(value: string): boolean {
  return value.startsWith(SCIM_TOKEN_PREFIX) && TOKEN_BODY.test(value.slice(SCIM_TOKEN_PREFIX.length));
}

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compare two hex hashes without leaking their first differing byte. */
export function scimTokenMatchesHash(expectedHash: string, presentedHash: string): boolean {
  const expected = Buffer.from(expectedHash, "utf8");
  const presented = Buffer.from(presentedHash, "utf8");
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

/** Extract the token from an "Authorization: Bearer ..." header. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** last_used_at is advisory; writing it at most once a minute avoids a write per request. */
export function shouldTouchLastUsed(lastUsedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!lastUsedAt) return true;
  const value = lastUsedAt instanceof Date ? lastUsedAt.getTime() : new Date(lastUsedAt).getTime();
  if (Number.isNaN(value)) return true;
  return now - value >= 60_000;
}
