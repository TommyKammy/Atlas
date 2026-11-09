import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { audit } from "@/lib/audit";
import {
  deletePortfolio,
  getPortfolio,
  getPortfolioProjects,
  getPortfolioRules,
  updatePortfolio,
} from "@/lib/repositories/portfolios";

export const GET = withUser(async (_req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid portfolio id" }, { status: 400 });
  }
  const portfolio = await getPortfolio(id, ws.id, uid);
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [projects, rules] = await Promise.all([
    getPortfolioProjects(id),
    getPortfolioRules(id),
  ]);
  return NextResponse.json({ portfolio, projects, rules });
});

export const PATCH = withUser(async (req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const id = Number(params.id);
  const portfolio = Number.isInteger(id) ? await getPortfolio(id, ws.id, uid) : null;
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!portfolio.can_edit) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
  } | null;
  const patch: { name?: string; description?: string } = {};
  if (typeof body?.name === "string" && body.name.trim() !== "") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  await updatePortfolio(id, patch);
  await audit(uid, "portfolio.update", { entity: "portfolio", entityId: id });
  return NextResponse.json({ id });
});

export const DELETE = withUser(async (_req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const id = Number(params.id);
  const portfolio = Number.isInteger(id) ? await getPortfolio(id, ws.id, uid) : null;
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!portfolio.can_edit) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await deletePortfolio(id);
  await audit(uid, "portfolio.delete", { entity: "portfolio", entityId: id });
  return NextResponse.json({ deleted: id });
});
