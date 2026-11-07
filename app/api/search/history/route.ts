import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { clearSearchHistory, getSearchHistory, saveSearchHistory } from "@/lib/data";

export const GET = withUser(async (_req, { uid }) => {
  return NextResponse.json({ history: await getSearchHistory(uid) });
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (query === "") return NextResponse.json({ error: "query is required" }, { status: 400 });
  await saveSearchHistory(uid, query);
  return NextResponse.json({ ok: true, history: await getSearchHistory(uid) });
});

export const DELETE = withUser(async (_req, { uid }) => {
  await clearSearchHistory(uid);
  return NextResponse.json({ ok: true, history: [] });
});
