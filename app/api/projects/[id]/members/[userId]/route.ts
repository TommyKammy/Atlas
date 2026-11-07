import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { normalizeProjectRole } from "@/lib/project-roles";

async function adminCount(projectId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'",
    [projectId],
  );
  return r.rows[0].n as number;
}

export const PATCH = withProject("admin", async (_req, { uid, projectId, params, body }) => {
  const targetId = Number(params.userId);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }
  const payload = (body ?? {}) as { role?: unknown };
  const role = normalizeProjectRole(typeof payload.role === "string" ? payload.role : "");
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
  await audit(uid, "project.member_role", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId} → ${role}`,
  });
  return NextResponse.json({ user_id: targetId, role });
}, { body: true });

export const DELETE = withProject("admin", async (_req, { uid, projectId, params }) => {
  const targetId = Number(params.userId);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }

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
  await audit(uid, "project.member_remove", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId}`,
  });
  return NextResponse.json({ removed: targetId });
});
