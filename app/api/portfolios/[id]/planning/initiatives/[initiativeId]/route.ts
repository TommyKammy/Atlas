import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { removeInitiativeFromPeriod, updateInitiative } from "@/lib/planning/mutations";
import {
  parseDemandInputs,
  parseInitiativeKind,
  parseName,
  parseNullableCostYen,
  parseNullableOwnerMemberId,
  parseOptionalProjectId,
  parseOwnerNameHint,
  parsePositiveId,
  parseRevision,
} from "@/lib/planning/validation";

export const PATCH = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const initiativeId = parsePositiveId(params.initiativeId, "案件ID");
  const body = await readObjectBody(req);
  const periodId = parsePositiveId(body.periodId, "対象四半期ID");
  const revision = parseRevision(body.revision);
  const result = await updateInitiative({
    workspaceId,
    portfolioId,
    userId: uid,
    initiativeId,
    periodId,
    revision,
    name: parseName(body.name, "案件名", 160),
    ownerMemberId:
      body.ownerMemberId === undefined ? undefined : parseNullableOwnerMemberId(body.ownerMemberId),
    ownerNameHint: parseOwnerNameHint(body.ownerName),
    expectedEffect: parseName(body.expectedEffect, "期待効果", 1000),
    kind: parseInitiativeKind(body.kind),
    linkedProjectId: parseOptionalProjectId(body.linkedProjectId),
    costYen: parseNullableCostYen(body.costYen),
    demands: parseDemandInputs(body.demands),
  });
  return NextResponse.json(result);
});

export const DELETE = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const initiativeId = parsePositiveId(params.initiativeId, "案件ID");
  const url = new URL(req.url);
  const periodId = parsePositiveId(url.searchParams.get("periodId"), "対象四半期ID");
  const revision = parseRevision(url.searchParams.get("revision"));
  const result = await removeInitiativeFromPeriod({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    initiativeId,
    revision,
  });
  return NextResponse.json(result);
});
