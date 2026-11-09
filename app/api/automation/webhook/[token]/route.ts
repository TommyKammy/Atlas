import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitDomainEvent } from "@/lib/domain/events";

function validSignature(secret: string, raw: string, signature: string): boolean {
  if (secret === "") return true;
  if (signature === "") return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
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
  if (endpoint.rowCount === 0 || endpoint.rows[0].enabled !== true) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-atlas-signature") ?? "";
  if (!validSignature(String(endpoint.rows[0].secret ?? ""), raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown = {};
  if (raw.trim() !== "") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
  }
  const data: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), payload }
      : { payload };
  delete data.target_rule_id;
  await emitDomainEvent({
    workspaceId: Number(endpoint.rows[0].workspace_id),
    projectId: Number(endpoint.rows[0].project_id),
    actorId: null,
    type: "webhook.received",
    subjectType: "webhook",
    subjectId: Number(endpoint.rows[0].id),
    data: { ...data, endpoint_id: Number(endpoint.rows[0].id) },
    correlationId: `webhook:${endpoint.rows[0].id}:${Date.now()}`,
  });
  return NextResponse.json({ received: true }, { status: 202 });
}
