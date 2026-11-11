import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type MfaSecretPurpose = "active" | "pending";
type Environment = Record<string, string | undefined>;
type Keyring = { activeId: string; keys: Map<string, Buffer> };

/** No secret, ciphertext, environment value or crypto-provider detail is exposed. */
export class MfaSecretUnavailableError extends Error {
  constructor(readonly reason: "unconfigured" | "invalid_configuration" | "invalid_secret") {
    super("Two-factor authentication is temporarily unavailable. Check the MFA encryption key configuration.");
    this.name = "MfaSecretUnavailableError";
  }
}

const PREFIX = "atlas-mfa:v1:";
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SECRET = /^[A-Z2-7]{16,128}$/;

function readKeyring(env: Environment): Keyring {
  if (!env.MFA_ENCRYPTION_KEYS || !env.MFA_ENCRYPTION_KEY_ID) throw new MfaSecretUnavailableError("unconfigured");
  try {
    const parsed: unknown = JSON.parse(env.MFA_ENCRYPTION_KEYS);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const activeId = env.MFA_ENCRYPTION_KEY_ID;
    if (!KEY_ID.test(activeId)) throw new Error();
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.length > 16) throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of entries) {
      if (!KEY_ID.test(id) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value) throw new Error();
      keys.set(id, key);
    }
    if (!keys.has(activeId)) throw new Error();
    return { activeId, keys };
  } catch {
    throw new MfaSecretUnavailableError("invalid_configuration");
  }
}

function aad(userId: string | number, purpose: MfaSecretPurpose, keyId: string): Buffer {
  if ((typeof userId === "number" && (!Number.isSafeInteger(userId) || userId <= 0)) ||
      !/^[1-9][0-9]*$/.test(String(userId)) || (purpose !== "active" && purpose !== "pending")) {
    throw new MfaSecretUnavailableError("invalid_secret");
  }
  return Buffer.from(JSON.stringify(["atlas", "mfa", 1, String(userId), purpose, keyId]));
}

function normalizeSecret(secret: string): string {
  const normalized = secret.toUpperCase().replace(/\s+/g, "").replace(/=+$/, "");
  if (!SECRET.test(normalized)) throw new MfaSecretUnavailableError("invalid_secret");
  return normalized;
}

function decodePart(value: string, bytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new MfaSecretUnavailableError("invalid_secret");
  const decoded = Buffer.from(value, "base64url");
  if ((bytes !== undefined && decoded.length !== bytes) || decoded.toString("base64url") !== value) {
    throw new MfaSecretUnavailableError("invalid_secret");
  }
  return decoded;
}

export function isEncryptedMfaSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function mfaSecretKeyId(value: string): string {
  if (!isEncryptedMfaSecret(value)) throw new MfaSecretUnavailableError("invalid_secret");
  const parts = value.split(":");
  if (parts.length !== 6 || !KEY_ID.test(parts[2])) throw new MfaSecretUnavailableError("invalid_secret");
  return parts[2];
}

export function encryptMfaSecret(secret: string, userId: string | number, purpose: MfaSecretPurpose,
  env: Environment = process.env): string {
  const { activeId, keys } = readKeyring(env);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(activeId)!, nonce);
  cipher.setAAD(aad(userId, purpose, activeId));
  const ciphertext = Buffer.concat([cipher.update(normalizeSecret(secret), "utf8"), cipher.final()]);
  return `${PREFIX}${activeId}:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;
}

/** Plaintext is accepted by the explicit migration only, never authentication. */
export function decryptMfaSecret(value: string, userId: string | number, purpose: MfaSecretPurpose,
  env: Environment = process.env): string {
  const { keys } = readKeyring(env);
  try {
    const keyId = mfaSecretKeyId(value);
    const [, , , nonceText, ciphertextText, tagText] = value.split(":");
    const key = keys.get(keyId);
    if (!key || ciphertextText.length > 171) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, decodePart(nonceText, 12));
    decipher.setAAD(aad(userId, purpose, keyId));
    decipher.setAuthTag(decodePart(tagText, 16));
    const plaintext = Buffer.concat([decipher.update(decodePart(ciphertextText)), decipher.final()]).toString("utf8");
    return normalizeSecret(plaintext);
  } catch {
    throw new MfaSecretUnavailableError("invalid_secret");
  }
}

export function activeMfaKeyId(env: Environment = process.env): string {
  return readKeyring(env).activeId;
}
