import { createHash, timingSafeEqual } from "node:crypto";

/** RFC 7636 code_verifier: 43-128 unreserved characters. */
const VERIFIER_FORMAT = /^[A-Za-z0-9\-._~]{43,128}$/;
/** S256 output is base64url(SHA-256(...)): exactly 43 characters. */
const CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && VERIFIER_FORMAT.test(value);
}

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CHALLENGE_FORMAT.test(value);
}

export function s256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Verify a PKCE pair. Only S256 is accepted; plain (the RFC 7636 default when
 * no method is sent) is rejected explicitly. The comparison is constant-time.
 */
export function verifyPkce(
  codeVerifier: unknown,
  codeChallenge: unknown,
  method: unknown = "S256",
): boolean {
  if (method !== "S256") return false;
  if (!isValidCodeVerifier(codeVerifier) || !isValidCodeChallenge(codeChallenge)) return false;
  const computed = s256Challenge(codeVerifier);
  const expected = Buffer.from(codeChallenge, "utf8");
  const actual = Buffer.from(computed, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
