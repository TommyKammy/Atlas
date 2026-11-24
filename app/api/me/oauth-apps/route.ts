import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { listOAuthApps } from "@/lib/services/oauth-apps";

export const GET = withUser(async (_req, { uid }) => {
  const apps = await listOAuthApps({ uid, source: "web" });
  return NextResponse.json({ apps });
});
