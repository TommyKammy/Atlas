import { NextResponse } from "next/server";
import { processPendingEvents } from "@/lib/automation/engine";

function authorized(req: Request): boolean {
  const expected = process.env.AUTOMATION_WORKER_TOKEN || "atlas-internal-automation";
  return req.headers.get("x-automation-token") === expected;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const forceScheduled = url.searchParams.get("scheduled") === "1";
  const result = await processPendingEvents(
    Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20,
    forceScheduled,
  );
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
