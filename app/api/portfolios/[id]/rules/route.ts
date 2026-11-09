import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { audit } from "@/lib/audit";
import { validateRuleDefinition } from "@/lib/automation/validate";
import {
  createPortfolioRule,
  getPortfolio,
  getPortfolioRules,
} from "@/lib/repositories/portfolios";

async function loadPortfolio(id: number, uid: number) {
  const ws = await getWorkspace();
  if (!ws) return { error: NextResponse.json({ error: "workspace not found" }, { status: 404 }) };
  if (!Number.isInteger(id) || id <= 0) {
    return { error: NextResponse.json({ error: "invalid portfolio id" }, { status: 400 }) };
  }
  const portfolio = await getPortfolio(id, ws.id, uid);
  if (!portfolio) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { portfolio, workspaceId: ws.id };
}

export const GET = withUser(async (_req, { uid, params }) => {
  const id = Number(params.id);
  const loaded = await loadPortfolio(id, uid);
  if (loaded.error) return loaded.error;
  return NextResponse.json({ rules: await getPortfolioRules(id) });
});

export const POST = withUser(async (req, { uid, params }) => {
  const id = Number(params.id);
  const loaded = await loadPortfolio(id, uid);
  if (loaded.error) return loaded.error;
  if (!loaded.portfolio?.can_edit) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    definition?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
  const validated = validateRuleDefinition(body?.definition);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  try {
    const ruleId = await createPortfolioRule({
      workspaceId: loaded.workspaceId!,
      portfolioId: id,
      name,
      description: typeof body?.description === "string" ? body.description.trim() : "",
      definition: validated.definition,
      ownerId: uid,
    });
    await audit(uid, "portfolio_rule.create", {
      entity: "portfolio_rule",
      entityId: ruleId,
      summary: name,
    });
    return NextResponse.json({ id: ruleId }, { status: 201 });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "rule creation failed" },
      { status: 400 },
    );
  }
});
