import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function totpCode(secret: string, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const normalized = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = totpCode(secret, now + offset * 30_000);
    const a = Buffer.from(expected);
    const b = Buffer.from(normalized);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, accountEmail: string, issuer: string): string {
  const label = `${issuer}:${accountEmail}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function consumeRecoveryCode(code: string, hashes: string[] | null | undefined): {
  ok: boolean;
  remaining: string[];
} {
  const hash = hashRecoveryCode(code);
  const list = Array.isArray(hashes) ? hashes : [];
  const index = list.indexOf(hash);
  if (index === -1) return { ok: false, remaining: list };
  return { ok: true, remaining: list.filter((_, i) => i !== index) };
}
