import { readKnowledge, readKnowledgeHistory } from "@/lib/services/authorized-data";
import { NextResponse } from "next/server";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { trashKnowledge, updateKnowledge } from "@/lib/services/knowledge";

export const GET = withResourceProject("view", "project_knowledge", async (req, { uid, params }) => {
  if (new URL(req.url).searchParams.get("history") === "1") {
    return NextResponse.json(await readKnowledgeHistory(Number(params.id), { userId: uid }));
  }
  return NextResponse.json(await readKnowledge(Number(params.id), { userId: uid }));
});

export const PATCH = withResourceProject("edit", "project_knowledge", async (_req, { uid, projectId, params, body }) => {
  const note = await updateKnowledge(Number(params.id), uid, body);
  await notifyProject(projectId);
  await audit(uid, "knowledge.update", { entity: "knowledge", entityId: note.id, projectId });
  return NextResponse.json(note);
}, { body: true });

export const DELETE = withResourceProject("edit", "project_knowledge", async (req, { uid, projectId, params }) => {
  const revision = new URL(req.url).searchParams.get("revision");
  if (revision !== null && !/^\d+$/.test(revision)) return NextResponse.json({ error: "リビジョンが無効です" }, { status: 400 });
  const result = await trashKnowledge(Number(params.id), uid, revision === null ? undefined : Number(revision));
  await notifyProject(projectId);
  await audit(uid, "knowledge.delete", { entity: "knowledge", entityId: Number(params.id), projectId });
  return NextResponse.json(result);
});
