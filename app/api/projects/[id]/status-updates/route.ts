import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { isProjectStatusColor } from "@/lib/project-status";
import {
  createProjectStatusUpdate,
  getProjectStatusUpdates,
} from "@/lib/repositories/home";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json({ updates: await getProjectStatusUpdates(projectId) });
});

export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const payload = (body ?? {}) as { body?: unknown; status?: unknown; status_color?: unknown };
    const text = typeof payload.body === "string" ? payload.body.trim() : "";
    if (text === "") {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    if (text.length > 10_000) {
      return NextResponse.json({ error: "body is too long" }, { status: 400 });
    }
    const status =
      typeof payload.status === "string" && payload.status.trim() !== ""
        ? payload.status.trim().slice(0, 80)
        : null;
    const color = isProjectStatusColor(payload.status_color) ? payload.status_color : "none";
    const id = await createProjectStatusUpdate(projectId, uid, text, status, color);
    await audit(uid, "project.status_update", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: text.slice(0, 120),
    });
    return NextResponse.json(
      { id, updates: await getProjectStatusUpdates(projectId) },
      { status: 201 },
    );
  },
  { body: true },
);
