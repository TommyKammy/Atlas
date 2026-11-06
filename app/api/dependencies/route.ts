import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { task_id, depends_on_id } = body;
  if (!task_id || !depends_on_id || task_id === depends_on_id) {
    return NextResponse.json({ error: "task_id and depends_on_id are required (distinct)" }, { status: 400 });
  }
  const projectId = await getTaskProjectId(Number(task_id));
  if (projectId !== null) {
    const auth = await requireProjectPermission(req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await db.query(
    "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING",
    [task_id, depends_on_id],
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("task_id");
  const dependsOnId = searchParams.get("depends_on_id");
  if (!taskId || !dependsOnId) {
    return NextResponse.json({ error: "task_id and depends_on_id are required" }, { status: 400 });
  }
  const projectId = await getTaskProjectId(Number(taskId));
  if (projectId !== null) {
    const auth = await requireProjectPermission(req, projectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await db.query("DELETE FROM task_dependencies WHERE task_id = $1::bigint AND depends_on_id = $2::bigint", [
    taskId,
    dependsOnId,
  ]);
  return NextResponse.json({ ok: true });
}
