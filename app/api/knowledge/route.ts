import { listKnowledge } from "@/lib/services/authorized-data";
import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { createKnowledge } from "@/lib/services/knowledge";

export const GET = withProject("view", async (req, { projectId, uid }) => {
  const params = new URL(req.url).searchParams;
  const query = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  return NextResponse.json(await listKnowledge(projectId, { userId: uid }, { query, offset }));
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const note = await createKnowledge(projectId, uid, body);
  await notifyProject(projectId);
  await audit(uid, "knowledge.create", { entity: "knowledge", entityId: note.id, projectId });
  return NextResponse.json(note, { status: 201 });
}, { body: true });
