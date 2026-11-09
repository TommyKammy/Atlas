import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "atlas_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

/** Opaque 256-bit session token, base64url encoded. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only a hash is stored at rest; the raw token lives in the cookie. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 random bytes encode to 43 base64url characters. */
export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
