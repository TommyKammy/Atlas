import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
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
  return NextResponse.json({ ok: true });
});
