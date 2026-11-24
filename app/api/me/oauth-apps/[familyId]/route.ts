import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { revokeOAuthApp } from "@/lib/services/oauth-apps";

export const DELETE = withUser(async (_req, { uid, params }) => {
  const result = await revokeOAuthApp({ uid, source: "web" }, params.familyId);
  return NextResponse.json({ revoked: result.family_id });
});
