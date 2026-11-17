import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, requireWorkspaceId } from "@/lib/planning/http";
import { removePlanViewer } from "@/lib/planning/mutations";
import { parsePositiveId } from "@/lib/planning/validation";

export const DELETE = withUser(async (_req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const viewerId = parsePositiveId(params.userId, "閲覧者");
  await removePlanViewer({ workspaceId, portfolioId, userId: uid, viewerId });
  return NextResponse.json({ ok: true });
});
