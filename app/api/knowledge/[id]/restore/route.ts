import { NextResponse } from "next/server";
import { withResourceProject } from "@/lib/api/route";
import { restoreKnowledge } from "@/lib/services/knowledge";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const POST = withResourceProject("edit", "project_knowledge", async (_req, { uid, projectId, params, body }) => {
  const revision = body && typeof body === "object" && "expected_revision" in body ? body.expected_revision : undefined;
  const note = await restoreKnowledge(Number(params.id), uid, revision);
  await audit(uid, "knowledge.restore", { entity: "knowledge", entityId: Number(params.id), projectId });
  await notifyProject(projectId);
  return NextResponse.json(note);
}, { body: true });
