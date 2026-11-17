import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { addPlanViewer } from "@/lib/planning/mutations";
import { parsePositiveId } from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const viewerId = parsePositiveId(body.userId, "閲覧者");
  await addPlanViewer({ workspaceId, portfolioId, userId: uid, viewerId });
  await audit(uid, "portfolio_plan.viewer_add", {
    entity: "portfolio",
    entityId: portfolioId,
    summary: `user:${viewerId}`,
  });
  return NextResponse.json({ ok: true });
});
