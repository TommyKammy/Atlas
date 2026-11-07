import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTaskPermission } from "@/lib/api-project-auth";
import { withTask } from "@/lib/api/route";

export const POST = withTask("edit", async (req, { taskId: task_id, body }) => {
  const { depends_on_id } = (body ?? {}) as { depends_on_id?: number };
  if (!depends_on_id || depends_on_id === task_id) {
    return NextResponse.json({ error: "task_id and depends_on_id are required (distinct)" }, { status: 400 });
  }
  const toAuth = await requireTaskPermission(req, Number(depends_on_id), "edit");
  if (!toAuth.ok) return NextResponse.json({ error: toAuth.error }, { status: toAuth.status });
  const cycle = await db.query(
    `WITH RECURSIVE chain(id) AS (
       SELECT $2::bigint
       UNION
       SELECT d.depends_on_id
         FROM task_dependencies d
         JOIN chain c ON d.task_id = c.id
     )
     SELECT 1 FROM chain WHERE id = $1::bigint LIMIT 1`,
    [task_id, depends_on_id],
  );
  if ((cycle.rowCount ?? 0) > 0) {
    return NextResponse.json({ error: "dependency cycle" }, { status: 409 });
  }
  await db.query(
    "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING",
    [task_id, depends_on_id],
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}, { body: true });

export const DELETE = withTask("edit", async (req, { taskId }) => {
  const { searchParams } = new URL(req.url);
  const dependsOnId = searchParams.get("depends_on_id");
  if (!dependsOnId) {
    return NextResponse.json({ error: "task_id and depends_on_id are required" }, { status: 400 });
  }
  const depAuth = await requireTaskPermission(req, Number(dependsOnId), "edit");
  if (!depAuth.ok) return NextResponse.json({ error: depAuth.error }, { status: depAuth.status });
  await db.query("DELETE FROM task_dependencies WHERE task_id = $1::bigint AND depends_on_id = $2::bigint", [
    taskId,
    dependsOnId,
  ]);
  return NextResponse.json({ ok: true });
});
