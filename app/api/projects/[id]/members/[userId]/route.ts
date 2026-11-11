import { NextResponse } from "next/server";
import { changeProjectMember } from "@/lib/services/project-member";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { normalizeProjectRole } from "@/lib/project-roles";

export const PATCH = withProject("share", async (_req, { uid, projectId, params, body }) => {
  const targetId = Number(params.userId);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }
  const payload = (body ?? {}) as { role?: unknown };
  const role = normalizeProjectRole(typeof payload.role === "string" ? payload.role : "");
  if (!role) return NextResponse.json({ error: "valid role required" }, { status: 400 });

  await changeProjectMember(uid, projectId, targetId, role);
  await notifyProject(projectId);
  await audit(uid, "project.member_role", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId} → ${role}`,
  });
  return NextResponse.json({ user_id: targetId, role });
}, { body: true });

export const DELETE = withProject("share", async (_req, { uid, projectId, params }) => {
  const targetId = Number(params.userId);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "invalid member" }, { status: 400 });
  }

  await changeProjectMember(uid, projectId, targetId, null);
  await notifyProject(projectId);
  await audit(uid, "project.member_remove", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `user ${targetId}`,
  });
  return NextResponse.json({ removed: targetId });
});
