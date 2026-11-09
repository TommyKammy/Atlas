import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { audit } from "@/lib/audit";
import { validateRuleDefinition } from "@/lib/automation/validate";
import type { RuleDefinition } from "@/lib/automation/types";
import {
  deletePortfolioRule,
  getPortfolio,
  getPortfolioRule,
  updatePortfolioRule,
} from "@/lib/repositories/portfolios";

async function load(id: number, ruleId: number, uid: number) {
  const ws = await getWorkspace();
  if (!ws) return { error: NextResponse.json({ error: "workspace not found" }, { status: 404 }) };
  const portfolio = await getPortfolio(id, ws.id, uid);
  if (!portfolio) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (!portfolio.can_edit) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const rule = await getPortfolioRule(ruleId, id);
  if (!rule) return { error: NextResponse.json({ error: "rule not found" }, { status: 404 }) };
  return { portfolio, rule };
}

export const PATCH = withUser(async (req, { uid, params }) => {
  const id = Number(params.id);
  const ruleId = Number(params.ruleId);
  const loaded = await load(id, ruleId, uid);
  if (loaded.error) return loaded.error;
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    definition?: unknown;
    enabled?: unknown;
  } | null;
  const patch: {
    name?: string;
    description?: string;
    definition?: RuleDefinition;
    enabled?: boolean;
  } = {};
  if (typeof body?.name === "string" && body.name.trim() !== "") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  if (body?.definition !== undefined) {
    const validated = validateRuleDefinition(body.definition);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    patch.definition = validated.definition;
  }
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  await updatePortfolioRule(ruleId, id, patch);
  await audit(uid, "portfolio_rule.update", {
    entity: "portfolio_rule",
    entityId: ruleId,
  });
  return NextResponse.json({ id: ruleId });
});

export const DELETE = withUser(async (_req, { uid, params }) => {
  const id = Number(params.id);
  const ruleId = Number(params.ruleId);
  const loaded = await load(id, ruleId, uid);
  if (loaded.error) return loaded.error;
  await deletePortfolioRule(ruleId, id);
  await audit(uid, "portfolio_rule.delete", {
    entity: "portfolio_rule",
    entityId: ruleId,
  });
  return NextResponse.json({ deleted: ruleId });
});
