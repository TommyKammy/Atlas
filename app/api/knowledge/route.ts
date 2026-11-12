import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { createKnowledge, knowledgeColumns } from "@/lib/services/knowledge";

export const GET = withProject("view", async (req, { projectId }) => {
  const params = new URL(req.url).searchParams;
  const query = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  if (query.length > 300 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return NextResponse.json({ error: "検索条件が無効です" }, { status: 400 });
  const r = await db.query(`SELECT ${knowledgeColumns} FROM project_knowledge k
    WHERE project_id = $1 AND ($2 = '' OR position(lower($2) in lower(title || E'\\n' || body)) > 0)
    ORDER BY updated_at DESC, id DESC LIMIT 100 OFFSET $3`, [projectId, query, offset]);
  return NextResponse.json(r.rows);
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const note = await createKnowledge(projectId, uid, body);
  await notifyProject(projectId);
  await audit(uid, "knowledge.create", { entity: "knowledge", entityId: note.id, projectId });
  return NextResponse.json(note, { status: 201 });
}, { body: true });
