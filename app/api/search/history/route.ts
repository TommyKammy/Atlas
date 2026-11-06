import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/api-project-auth";
import { clearSearchHistory, getSearchHistory, saveSearchHistory } from "@/lib/data";

export async function GET(req: Request) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  return NextResponse.json({ history: await getSearchHistory(active.uid) });
}

export async function POST(req: Request) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (query === "") return NextResponse.json({ error: "query is required" }, { status: 400 });
  await saveSearchHistory(active.uid, query);
  return NextResponse.json({ ok: true, history: await getSearchHistory(active.uid) });
}

export async function DELETE(req: Request) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  await clearSearchHistory(active.uid);
  return NextResponse.json({ ok: true, history: [] });
}
