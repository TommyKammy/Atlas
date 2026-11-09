import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_COOKIE,
} from "./session-token";

test("session cookie name is the opaque atlas_session", () => {
  assert.equal(SESSION_COOKIE, "atlas_session");
});

test("generated tokens are 43-character base64url strings", () => {
  for (let i = 0; i < 32; i += 1) {
    const token = generateSessionToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(isSessionToken(token), true);
  }
});

test("generated tokens are unique", () => {
  const tokens = new Set(Array.from({ length: 128 }, () => generateSessionToken()));
  assert.equal(tokens.size, 128);
});

test("legacy numeric atlas_uid values are rejected", () => {
  assert.equal(isSessionToken("1"), false);
  assert.equal(isSessionToken("42"), false);
  assert.equal(isSessionToken("00000000"), false);
  assert.equal(isSessionToken(""), false);
  assert.equal(isSessionToken(null), false);
  assert.equal(isSessionToken(undefined), false);
});

test("tokens of the wrong length or alphabet are rejected", () => {
  assert.equal(isSessionToken("a".repeat(42)), false);
  assert.equal(isSessionToken("a".repeat(44)), false);
  assert.equal(isSessionToken(`${"a".repeat(42)}+`), false);
  assert.equal(isSessionToken(`${"a".repeat(42)}/`), false);
  assert.equal(isSessionToken(`${"a".repeat(42)}.`), false);
});

test("token hashes are stable, distinct and never contain the raw token", () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  const ha = hashSessionToken(a);
  assert.match(ha, /^[0-9a-f]{64}$/);
  assert.equal(hashSessionToken(a), ha);
  assert.notEqual(hashSessionToken(b), ha);
  assert.equal(ha.includes(a), false);
});
