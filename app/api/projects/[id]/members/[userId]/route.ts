import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { normalizeProjectRole } from "@/lib/project-roles";

async function adminCount(projectId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'",
    [projectId],
  );
  return r.rows[0].n as number;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const projectId = Number(id);
  const targetId = Number(userId);
  if (!Number.isInteger(projectId) || !Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const role = normalizeProjectRole(typeof body?.role === "string" ? body.role : "");
  if (!role) return NextResponse.json({ error: "valid role required" }, { status: 400 });

  const current = await db.query(
    "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, targetId],
  );
  if (current.rowCount === 0) return NextResponse.json({ error: "member not found" }, { status: 404 });
  if (normalizeProjectRole(current.rows[0].role) === "admin" && role !== "admin" && (await adminCount(projectId)) <= 1) {
    return NextResponse.json({ error: "cannot remove the last project admin" }, { status: 400 });
  }

  await db.query(
    "UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3",
    [role, projectId, targetId],
  );
  await notifyProject(projectId);
  await audit(auth.uid, "project.member_role", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId} → ${role}`,
  });
  return NextResponse.json({ user_id: targetId, role });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const projectId = Number(id);
  const targetId = Number(userId);
  if (!Number.isInteger(projectId) || !Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const current = await db.query(
    "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, targetId],
  );
  if (current.rowCount === 0) return NextResponse.json({ error: "member not found" }, { status: 404 });
  if (normalizeProjectRole(current.rows[0].role) === "admin" && (await adminCount(projectId)) <= 1) {
    return NextResponse.json({ error: "cannot remove the last project admin" }, { status: 400 });
  }

  await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [
    projectId,
    targetId,
  ]);
  await notifyProject(projectId);
  await audit(auth.uid, "project.member_remove", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId}`,
  });
  return NextResponse.json({ removed: targetId });
}
