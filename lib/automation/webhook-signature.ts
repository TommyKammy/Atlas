import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 300;

export function automationWebhookDelivery(seed: string, actionIndex: number, plannedAt: Date) {
  return {
    id: createHash("sha256").update(`atlas:${seed}:${actionIndex}`).digest("hex"),
    sentAt: plannedAt.toISOString(),
  };
}

export function signWebhook(
  secret: string,
  timestamp: string,
  deliveryId: string,
  body: string | Buffer,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.`)
    .update(body)
    .digest("hex");
}

export function verifyWebhook(
  secret: string,
  timestamp: string,
  deliveryId: string,
  body: Buffer,
  signature: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret.trim() || !/^[1-9][0-9]{0,11}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId) || !/^[a-fA-F0-9]{64}$/.test(signature)) {
    return false;
  }
  const expected = signWebhook(secret, timestamp, deliveryId, body);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
