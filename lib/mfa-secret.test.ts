import assert from "node:assert/strict";
import test from "node:test";
import { activeMfaKeyId, decryptMfaSecret, encryptMfaSecret, MfaSecretUnavailableError, mfaSecretKeyId } from "./mfa-secret";

const secret = "JBSWY3DPEHPK3PXP";
const key1 = Buffer.alloc(32, 23).toString("base64");
const key2 = Buffer.alloc(32, 47).toString("base64");
const env = { MFA_ENCRYPTION_KEY_ID: "first", MFA_ENCRYPTION_KEYS: JSON.stringify({ first: key1 }) };

test("MFA encryption round trips without reusing a nonce or storing the original secret", () => {
  const first = encryptMfaSecret(secret, 12, "active", env);
  const second = encryptMfaSecret(secret, 12, "active", env);
  assert.notEqual(first, second);
  assert.equal(first.includes(secret), false);
  assert.equal(decryptMfaSecret(first, 12, "active", env), secret);
  assert.equal(decryptMfaSecret(second, 12, "active", env), secret);
});

test("MFA ciphertext is bound to its user and active or pending purpose", () => {
  const pending = encryptMfaSecret(secret, 12, "pending", env);
  assert.equal(decryptMfaSecret(pending, "12", "pending", env), secret);
  assert.throws(() => decryptMfaSecret(pending, 13, "pending", env), MfaSecretUnavailableError);
  assert.throws(() => decryptMfaSecret(pending, 12, "active", env), MfaSecretUnavailableError);
  const aliases = { ...env, MFA_ENCRYPTION_KEYS: JSON.stringify({ first: key1, alias: key1 }) };
  assert.throws(() => decryptMfaSecret(pending.replace(":first:", ":alias:"), 12, "pending", aliases), MfaSecretUnavailableError);
});

test("MFA refuses plaintext, unsupported versions and tampered encrypted records", () => {
  const encrypted = encryptMfaSecret(secret, 12, "active", env);
  const parts = encrypted.split(":");
  const modified = [secret, encrypted.replace(":v1:", ":v2:"), encrypted + ":extra", encrypted.slice(0, -1)];
  for (const index of [3, 4, 5]) {
    const copy = [...parts];
    copy[index] = `${copy[index][0] === "A" ? "B" : "A"}${copy[index].slice(1)}`;
    modified.push(copy.join(":"));
  }
  for (const value of modified) assert.throws(() => decryptMfaSecret(value, 12, "active", env), MfaSecretUnavailableError);
});

test("MFA key configuration is mandatory, strict and does not disclose supplied values", () => {
  const bad = [
    {}, { MFA_ENCRYPTION_KEY_ID: "first" },
    { ...env, MFA_ENCRYPTION_KEYS: "malformed confidential configuration" },
    { ...env, MFA_ENCRYPTION_KEYS: "[]" },
    { ...env, MFA_ENCRYPTION_KEYS: JSON.stringify({ first: "short confidential key" }) },
    { ...env, MFA_ENCRYPTION_KEYS: JSON.stringify({ first: Buffer.alloc(31).toString("base64") }) },
    { ...env, MFA_ENCRYPTION_KEY_ID: "missing" },
    { ...env, MFA_ENCRYPTION_KEY_ID: "first:other" },
  ];
  for (const options of bad) {
    assert.throws(() => encryptMfaSecret(secret, 12, "active", options), (error: unknown) => {
      assert.ok(error instanceof MfaSecretUnavailableError);
      assert.equal(error.message.includes("confidential"), false);
      assert.equal(error.message.includes(secret), false);
      assert.equal("cause" in error, false);
      return true;
    });
  }
});

test("MFA rotation reads retained old keys and writes only with the active key", () => {
  const old = encryptMfaSecret(secret, 12, "active", env);
  const rotated = { MFA_ENCRYPTION_KEY_ID: "second", MFA_ENCRYPTION_KEYS: JSON.stringify({ first: key1, second: key2 }) };
  assert.equal(activeMfaKeyId(rotated), "second");
  assert.equal(decryptMfaSecret(old, 12, "active", rotated), secret);
  const current = encryptMfaSecret(decryptMfaSecret(old, 12, "active", rotated), 12, "active", rotated);
  assert.equal(mfaSecretKeyId(current), "second");
  const newOnly = { ...rotated, MFA_ENCRYPTION_KEYS: JSON.stringify({ second: key2 }) };
  assert.equal(decryptMfaSecret(current, 12, "active", newOnly), secret);
  assert.throws(() => decryptMfaSecret(old, 12, "active", newOnly), MfaSecretUnavailableError);
  assert.throws(() => decryptMfaSecret(current, 12, "active", { ...newOnly, MFA_ENCRYPTION_KEYS: JSON.stringify({ second: key1 }) }), MfaSecretUnavailableError);
});

test("MFA normalizes valid legacy Base32 and rejects invalid secrets or identities", () => {
  const encrypted = encryptMfaSecret("jbsw y3dp ehpk3pxp=", 12, "active", env);
  assert.equal(decryptMfaSecret(encrypted, 12, "active", env), secret);
  for (const value of ["", "bad$secret", "A".repeat(129)]) assert.throws(() => encryptMfaSecret(value, 12, "active", env), MfaSecretUnavailableError);
  for (const id of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, "0012", "12:pending"]) {
    assert.throws(() => encryptMfaSecret(secret, id, "active", env), MfaSecretUnavailableError);
  }
});
