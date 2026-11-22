import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { createPersonalToken, listPersonalTokens } from "@/lib/services/mcp-tokens";

export const GET = withUser(async (_req, { uid }) => {
  const tokens = await listPersonalTokens({ uid, source: "web" });
  return NextResponse.json({ tokens });
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const created = await createPersonalToken({ uid, source: "web" }, body ?? {});
  // The plaintext token is returned exactly once and never stored or audited.
  return NextResponse.json(created, { status: 201 });
});
