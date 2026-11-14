import { createHmac, randomUUID } from "node:crypto";
import { postWebhook } from "../automation/webhook-outbound";
import { signWebhook } from "../automation/webhook-signature";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { asString } from "./shared";

export async function webhookPost(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const url = asString(params.url);
  const payload = JSON.stringify({
    source: ctx.source,
    rule_id: ctx.ruleId ?? null,
    event: ctx.event ?? null,
    project_id: ctx.projectId,
    task_id: ctx.event?.subject_type === "task" ? ctx.event.subject_id : null,
    sent_at: ctx.webhookDelivery?.sentAt ?? new Date().toISOString(),
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = asString(params.secret);
  const deliveryId = ctx.webhookDelivery?.id ?? randomUUID();
  headers["Idempotency-Key"] = deliveryId;
  headers["x-atlas-delivery-id"] = deliveryId;
  if (secret !== "") {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["x-atlas-timestamp"] = timestamp;
    headers["x-atlas-signature-v2"] = signWebhook(secret, timestamp, deliveryId, payload);
    // Keep the body-only signature for existing external recipients.
    headers["x-atlas-signature"] = createHmac("sha256", secret).update(payload).digest("hex");
  }
  const status = await postWebhook(url, payload, headers);
  if (status >= 300 && status < 400) throw new Error("invalid webhook destination: redirects are not allowed");
  if (status < 200 || status >= 300) throw new Error(`webhook returned ${status}`);
  return { summary: "Webhookを送信しました", data: { status } };
}
