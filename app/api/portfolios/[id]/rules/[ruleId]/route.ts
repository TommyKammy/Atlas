import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { audit } from "@/lib/audit";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { validateRuleConditionScope } from "@/lib/automation/condition-validation";
import { validateRuleCustomFieldActions } from "@/lib/automation/custom-field-actions";
import type { RuleDefinition } from "@/lib/automation/types";
import { retainWebhookSecrets } from "@/lib/automation/webhook-credentials";
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
    webhookActionIds?: unknown;
    expected_updated_at?: unknown;
  } | null;
  if (body?.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  // Replicas execute the definition with the portfolio rule owner's permissions.
  if (loaded.rule.owner_id !== uid && (body?.definition !== undefined || body?.enabled === true)) {
    return NextResponse.json(
      { error: "ルールの定義を変更・有効化できるのは所有者のみです" },
      { status: 403 },
    );
  }
  if (body?.expected_updated_at !== undefined &&
      (typeof body.expected_updated_at !== "string" || body.expected_updated_at.trim() === "")) {
    return NextResponse.json({ error: "invalid expected_updated_at" }, { status: 400 });
  }
  if (body?.expected_updated_at !== undefined && body.expected_updated_at !== loaded.rule.updated_at) {
    return NextResponse.json({ error: "ルールが更新されました。最新のルールを読み込んでください" }, { status: 409 });
  }
  const patch: {
    name?: string;
    description?: string;
    definition?: RuleDefinition;
    enabled?: boolean;
  } = {};
  if (typeof body?.name === "string" && body.name.trim() !== "") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  if (body?.enabled === true && body.definition === undefined) {
    const validated = validateRuleDefinition(loaded.rule.definition);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  if (body?.definition !== undefined) {
    const validated = validateRuleDefinition(body.definition);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const conditions = await validateRuleConditionScope(validated.definition, { portfolioId: id }, uid);
    if (!conditions.ok) return NextResponse.json({ error: conditions.error }, { status: 400 });
    const retained = retainWebhookSecrets(validated.definition, loaded.rule.definition,
      `portfolio:${loaded.rule.id}:${loaded.rule.version}`, body.webhookActionIds === true);
    if (!retained.ok) return NextResponse.json({ error: retained.error }, { status: 400 });
    patch.definition = retained.definition;
    const customFields = await validateRuleCustomFieldActions(patch.definition, uid);
    if (!customFields.ok) return NextResponse.json({ error: customFields.error }, { status: customFields.status });
  }
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  const updated = await updatePortfolioRule(ruleId, id, patch, loaded.rule.version, loaded.rule.updated_at, uid);
  if (!updated) {
    return NextResponse.json({ error: "ルールが更新されました。最新のルールを読み込んでください" }, { status: 409 });
  }
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
  await deletePortfolioRule(ruleId, id, uid);
  await audit(uid, "portfolio_rule.delete", {
    entity: "portfolio_rule",
    entityId: ruleId,
  });
  return NextResponse.json({ deleted: ruleId });
});
