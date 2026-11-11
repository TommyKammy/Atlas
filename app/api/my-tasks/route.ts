import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parseMyTaskOrderRequest } from "@/lib/my-task-order";
import { getMyTaskOrderSnapshot, saveMyTaskOrder } from "@/lib/services/my-task-order";

export const GET = withUser(async (_req, { uid }) =>
  NextResponse.json(await getMyTaskOrderSnapshot(uid), { headers: { "Cache-Control": "no-store" } }),
);

export const PUT = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const parsed = parseMyTaskOrderRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...await saveMyTaskOrder(uid, parsed.value) });
});
