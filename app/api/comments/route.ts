import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json();
  const { task_id, body: text } = body;
  if (!task_id || !text || String(text).trim() === "") {
    return NextResponse.json({ error: "task_id and body are required" }, { status: 400 });
  }
  const taskProjectId = await getTaskProjectId(Number(task_id));
  if (taskProjectId !== null) {
    const auth = await requireProjectPermission(req, taskProjectId, "comment");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const r = await db.query(
    "INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
    [task_id, uid, String(text).trim()],
  );
  await notifyTask(task_id);
  await audit(getCurrentUserIdFromRequest(req), "comment.create", { entity: "comment", entityId: r.rows[0].id, summary: String(text).trim().slice(0, 120) });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
