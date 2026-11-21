import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCIM_TOKEN_PREFIX, bearerToken, generateScimToken, hashScimToken, isScimToken,
  scimTokenMatchesHash, shouldTouchLastUsed,
} from "./token";

test("tokens are atlas_scim_ plus 32 random bytes in base64url", () => {
  const token = generateScimToken();
  assert.ok(token.startsWith(SCIM_TOKEN_PREFIX));
  assert.match(token.slice(SCIM_TOKEN_PREFIX.length), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isScimToken(token), true);
  assert.notEqual(token, generateScimToken());
});

test("malformed tokens are rejected before hashing", () => {
  assert.equal(isScimToken("atlas_scim_short"), false);
  assert.equal(isScimToken("atlas_session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("only the SHA-256 hash is stable and comparison is constant-time-safe", () => {
  const token = generateScimToken();
  const hash = hashScimToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashScimToken(token));
  assert.equal(scimTokenMatchesHash(hash, hash), true);
  assert.equal(scimTokenMatchesHash(hash, hashScimToken(generateScimToken())), false);
  assert.equal(scimTokenMatchesHash(hash, "short"), false);
});

test("bearer parsing accepts the standard scheme only", () => {
  assert.equal(bearerToken("Bearer atlas_scim_abc"), "atlas_scim_abc");
  assert.equal(bearerToken("bearer   token  "), "token");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken(null), null);
});

test("last_used_at is written at most once a minute", () => {
  const now = Date.parse("2026-01-01T00:01:00.000Z");
  assert.equal(shouldTouchLastUsed(null, now), true);
  assert.equal(shouldTouchLastUsed(new Date(now - 59_000), now), false);
  assert.equal(shouldTouchLastUsed(new Date(now - 60_000), now), true);
  assert.equal(shouldTouchLastUsed("not-a-date", now), true);
});
