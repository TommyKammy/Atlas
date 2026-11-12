import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { listKnowledgeTrash } from "@/lib/services/authorized-data";

export const GET = withProject("edit", async (req, { uid, projectId }) => {
  const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
  return NextResponse.json(await listKnowledgeTrash(projectId, { userId: uid }, offset));
});
