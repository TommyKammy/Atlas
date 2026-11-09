import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getUserNotepad, saveUserNotepad } from "@/lib/repositories/home";

export const GET = withUser(async (_req, { uid }) => {
  return NextResponse.json({ notepad: await getUserNotepad(uid) });
});

export const PUT = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const text = (body as { body?: unknown } | null)?.body;
  if (typeof text !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (text.length > 50_000) {
    return NextResponse.json({ error: "body is too long" }, { status: 400 });
  }
  return NextResponse.json({ notepad: await saveUserNotepad(uid, text) });
});
