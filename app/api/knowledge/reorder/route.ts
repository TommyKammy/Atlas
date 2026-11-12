import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { reorderKnowledge } from "@/lib/services/knowledge";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const result = await reorderKnowledge(projectId, body);
  if (result.changed) {
    await notifyProject(projectId);
    await audit(uid, "knowledge.reorder", { entity: "project", entityId: projectId, projectId });
  }
  return NextResponse.json({ order: result.order });
}, { body: true });
