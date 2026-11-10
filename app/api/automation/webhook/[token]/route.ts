import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { emitDomainEvent } from "@/lib/domain/events";
import { verifyWebhook } from "@/lib/automation/webhook-signature";

const MAX_BODY_BYTES = 256 * 1024;

async function readBody(req: Request): Promise<Buffer | null> {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, length);
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const endpoint = await db.query(
    `SELECT id, workspace_id, project_id, secret, enabled
     FROM automation_webhook_endpoints WHERE token = $1`,
    [token],
  );
  const row = endpoint.rows[0];
  if (!row?.enabled || !row.secret?.trim()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let raw: Buffer | null;
  try {
    raw = await readBody(req);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (raw === null) return NextResponse.json({ error: "body too large" }, { status: 413 });
  const timestamp = req.headers.get("x-atlas-timestamp") ?? "";
  const deliveryId = req.headers.get("x-atlas-delivery-id") ?? "";
  const signature = req.headers.get("x-atlas-signature-v2") ?? "";
  if (!verifyWebhook(row.secret, timestamp, deliveryId, raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown = {};
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    if (text.trim() !== "") payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const data: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), payload }
      : { payload };
  delete data.target_rule_id;
  const accepted = await withTransaction(async (q) => {
    const active = await q.query(
      "SELECT id FROM automation_webhook_endpoints WHERE id = $1 AND enabled AND secret = $2 FOR SHARE",
      [row.id, row.secret],
    );
    if (active.rowCount === 0) return "disabled";
    await q.query(
      "DELETE FROM automation_webhook_deliveries WHERE endpoint_id = $1 AND received_at < now() - interval '1 day'",
      [row.id],
    );
    const delivery = await q.query(
      `INSERT INTO automation_webhook_deliveries (endpoint_id, delivery_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING delivery_id`,
      [row.id, deliveryId],
    );
    if (delivery.rowCount === 0) return "duplicate";
    await emitDomainEvent({
      workspaceId: Number(row.workspace_id),
      projectId: Number(row.project_id),
      actorId: null,
      type: "webhook.received",
      subjectType: "webhook",
      subjectId: Number(row.id),
      data: { ...data, endpoint_id: Number(row.id) },
      correlationId: `webhook:${row.id}:${deliveryId}`,
    }, q);
    return "accepted";
  });
  if (accepted === "disabled") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (accepted === "duplicate") {
    return NextResponse.json({ error: "duplicate delivery" }, {
      status: 409,
      headers: { "x-atlas-duplicate-delivery-id": deliveryId },
    });
  }
  return NextResponse.json({ received: true }, { status: 202 });
}
