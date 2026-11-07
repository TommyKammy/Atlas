import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withUser } from "@/lib/api/route";
import { badRequest, notFound } from "@/lib/api/errors";
import { ensureDefaultProjectTabs } from "@/lib/repositories/projects";

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const { workspace_id, name } = body ?? {};
  if (!workspace_id || !name || String(name).trim() === "") {
    throw badRequest("workspace_id and name are required");
  }
  const workspaceId = Number(workspace_id);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw badRequest("invalid workspace_id");
  const workspace = await db.query("SELECT id FROM workspaces WHERE id = $1::bigint", [workspaceId]);
  if (workspace.rowCount === 0) throw notFound("workspace not found");
  const projectId = await withTransaction(async (q) => {
    const p = await q.query(
      "INSERT INTO projects (workspace_id, name) VALUES ($1::bigint, $2) RETURNING id",
      [workspaceId, String(name).trim()],
    );
    const id = Number(p.rows[0].id);
    await q.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
      [id, uid],
    );
    for (const [i, sname] of ["計画中", "進行中", "完了"].entries()) {
      await q.query("INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3)", [
        id,
        sname,
        (i + 1) * 1000,
      ]);
    }
    await ensureDefaultProjectTabs(id, q);
    return id;
  });
  await audit(uid, "project.create", { entity: "project", entityId: projectId, projectId, summary: String(name).trim() });
  return NextResponse.json({ id: projectId }, { status: 201 });
});
