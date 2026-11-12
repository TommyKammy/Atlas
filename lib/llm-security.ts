import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError, badRequest } from "./api/errors";

function masterKey() {
  const raw = process.env.LLM_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new ApiError(503, "LLM専用の暗号化キーをサーバーに設定してください");
  return Buffer.from(raw, "base64");
}
export function llmKeyReady() { try { masterKey(); return true; } catch { return false; } }
export function encryptLlmKey(value: string, id: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(`atlas-llm:${id}`));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptLlmKey(value: string | null, id: string) {
  if (!value) return "";
  try {
    const data = Buffer.from(value, "base64"), cipher = createDecipheriv("aes-256-gcm", masterKey(), data.subarray(0, 12));
    cipher.setAAD(Buffer.from(`atlas-llm:${id}`)); cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
  } catch { throw new ApiError(503, "接続キーを復号できません。管理者に再設定を依頼してください"); }
}
export function signLlmResult(value: object) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", masterKey()).update(`atlas-llm-result:${payload}`).digest("base64url")}`;
}
export function verifyLlmResult(token: unknown): Record<string, unknown> {
  if (typeof token !== "string" || token.length > 300000) throw badRequest("生成結果が無効です");
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", masterKey()).update(`atlas-llm-result:${payload}`).digest();
  const actual = Buffer.from(signature ?? "", "base64url");
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw badRequest("生成結果を検証できません");
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value.expires !== "number" || value.expires < Date.now()) throw new Error();
    return value;
  } catch { throw badRequest("生成結果の保存期限が切れました。コピーするか再生成してください"); }
}
