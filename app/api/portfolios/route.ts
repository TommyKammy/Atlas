import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { audit } from "@/lib/audit";
import {
  createPortfolio,
  getPortfolios,
} from "@/lib/repositories/portfolios";

export const GET = withUser(async (_req, { uid }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ portfolios: [] });
  return NextResponse.json({ portfolios: await getPortfolios(ws.id, uid) });
});

export const POST = withUser(async (req, { uid }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = await createPortfolio(
    ws.id,
    uid,
    name,
    typeof body?.description === "string" ? body.description.trim() : "",
  );
  await audit(uid, "portfolio.create", {
    entity: "portfolio",
    entityId: id,
    workspaceId: ws.id,
    summary: name,
  });
  return NextResponse.json({ id }, { status: 201 });
});
