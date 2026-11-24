import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidCodeChallenge, isValidCodeVerifier, s256Challenge, verifyPkce } from "./pkce";

const VERIFIER = "a".repeat(43);

test("a matching S256 verifier is accepted", () => {
  const challenge = s256Challenge(VERIFIER);
  assert.equal(isValidCodeChallenge(challenge), true);
  assert.equal(verifyPkce(VERIFIER, challenge), true);
  assert.equal(verifyPkce(VERIFIER, challenge, "S256"), true);
});

test("a wrong verifier is rejected", () => {
  const challenge = s256Challenge(VERIFIER);
  assert.equal(verifyPkce("b".repeat(43), challenge), false);
  assert.equal(verifyPkce(`${VERIFIER.slice(0, 42)}b`, challenge), false);
});

test("plain is rejected even when the verifier equals the challenge", () => {
  const challenge = VERIFIER;
  assert.equal(verifyPkce(VERIFIER, challenge, "plain"), false);
  assert.equal(verifyPkce(VERIFIER, challenge, "PLAIN"), false);
  assert.equal(verifyPkce(VERIFIER, challenge, "S512"), false);
});

test("code_verifier format requires 43-128 unreserved characters", () => {
  assert.equal(isValidCodeVerifier("a".repeat(43)), true);
  assert.equal(isValidCodeVerifier("a".repeat(128)), true);
  assert.equal(isValidCodeVerifier("a".repeat(42)), false);
  assert.equal(isValidCodeVerifier("a".repeat(129)), false);
  assert.equal(isValidCodeVerifier(`${"a".repeat(42)}+`), false);
  assert.equal(isValidCodeVerifier(`${"a".repeat(42)} `), false);
  assert.equal(isValidCodeVerifier(`${"a".repeat(42)}~`), true);
  assert.equal(isValidCodeVerifier(`${"a".repeat(42)}.`), true);
  assert.equal(isValidCodeVerifier(VERIFIER.slice(0, 42)), false);
  assert.equal(isValidCodeVerifier(undefined), false);
  assert.equal(isValidCodeVerifier(123), false);
});

test("a malformed challenge cannot verify", () => {
  assert.equal(isValidCodeChallenge("short"), false);
  assert.equal(isValidCodeChallenge(`${"a".repeat(42)}+`), false);
  assert.equal(isValidCodeChallenge(undefined), false);
  assert.equal(verifyPkce(VERIFIER, "short"), false);
});
