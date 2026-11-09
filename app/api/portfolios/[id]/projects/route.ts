import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace, getProjectAccess } from "@/lib/data";
import { audit } from "@/lib/audit";
import {
  addPortfolioProject,
  getPortfolio,
  removePortfolioProject,
} from "@/lib/repositories/portfolios";

async function loadPortfolio(id: number, uid: number) {
  const ws = await getWorkspace();
  if (!ws) return { error: NextResponse.json({ error: "workspace not found" }, { status: 404 }) };
  if (!Number.isInteger(id) || id <= 0) {
    return { error: NextResponse.json({ error: "invalid portfolio id" }, { status: 400 }) };
  }
  const portfolio = await getPortfolio(id, ws.id, uid);
  if (!portfolio) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (!portfolio.can_edit) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { portfolio, workspaceId: ws.id };
}

export const POST = withUser(async (req, { uid, params }) => {
  const id = Number(params.id);
  const loaded = await loadPortfolio(id, uid);
  if (loaded.error) return loaded.error;
  const body = (await req.json().catch(() => null)) as { project_id?: unknown } | null;
  const projectId = Number(body?.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const access = await getProjectAccess(uid, projectId);
  if (!access.role) return NextResponse.json({ error: "project access denied" }, { status: 403 });
  try {
    await addPortfolioProject(id, projectId);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "project add failed" },
      { status: 400 },
    );
  }
  await audit(uid, "portfolio.project_add", {
    entity: "portfolio",
    entityId: id,
    projectId,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = withUser(async (req, { uid, params }) => {
  const id = Number(params.id);
  const loaded = await loadPortfolio(id, uid);
  if (loaded.error) return loaded.error;
  const url = new URL(req.url);
  const projectId = Number(url.searchParams.get("project_id"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  await removePortfolioProject(id, projectId);
  await audit(uid, "portfolio.project_remove", {
    entity: "portfolio",
    entityId: id,
    projectId,
  });
  return NextResponse.json({ ok: true });
});
