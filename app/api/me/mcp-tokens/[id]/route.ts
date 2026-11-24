import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { revokePersonalToken } from "@/lib/services/mcp-tokens";

export const DELETE = withUser(async (_req, { uid, params }) => {
  const { id } = await revokePersonalToken({ uid, source: "web" }, Number(params.id));
  return NextResponse.json({ revoked: id });
});
