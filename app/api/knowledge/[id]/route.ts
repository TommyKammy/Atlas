import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { readKnowledge, updateKnowledge } from "@/lib/services/knowledge";

export const GET = withResourceProject("view", "project_knowledge", async (req, { params }) => {
  if (new URL(req.url).searchParams.get("history") === "1") {
    const rows = await db.query(`SELECT revision, title, saved_at::text AS saved_at
      FROM knowledge_revisions WHERE knowledge_id = $1 AND (revision = 0 OR revision IN
        (SELECT revision FROM knowledge_revisions WHERE knowledge_id = $1 ORDER BY revision DESC LIMIT 50))
      ORDER BY revision DESC`, [params.id]);
    return NextResponse.json(rows.rows);
  }
  return NextResponse.json(await readKnowledge(Number(params.id)));
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
  const result = await db.query(`DELETE FROM project_knowledge WHERE id = $1
    AND ($2::integer IS NULL OR revision = $2::integer) RETURNING id`, [params.id, revision]);
  if (!result.rowCount) return NextResponse.json({ error: "別の画面で更新されています。最新版を開いてください" }, { status: 409 });
  await notifyProject(projectId);
  await audit(uid, "knowledge.delete", { entity: "knowledge", entityId: Number(params.id), projectId });
  return NextResponse.json({ deleted: Number(params.id) });
});
