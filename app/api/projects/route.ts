import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireActiveUser } from "@/lib/api-project-auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { workspace_id, name } = body;
  if (!workspace_id || !name || String(name).trim() === "") {
    return NextResponse.json({ error: "workspace_id and name are required" }, { status: 400 });
  }
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  const p = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES ($1::bigint, $2) RETURNING id",
    [workspace_id, String(name).trim()],
  );
  const projectId = p.rows[0].id as number;
  const uid = getCurrentUserIdFromRequest(req);
  if (uid) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
      [projectId, uid],
    );
  }
  for (const [i, sname] of ["計画中", "進行中", "完了"].entries()) {
    await db.query("INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3)", [
      projectId,
      sname,
      (i + 1) * 1000,
    ]);
  }
  await audit(uid, "project.create", { entity: "project", entityId: projectId, projectId, summary: String(name).trim() });
  return NextResponse.json({ id: projectId }, { status: 201 });
}
