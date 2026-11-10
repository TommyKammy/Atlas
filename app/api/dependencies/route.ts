import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { conflict } from "@/lib/api/errors";
import { requireTaskPermission } from "@/lib/api-project-auth";
import { withTask } from "@/lib/api/route";

export const POST = withTask("edit", async (req, { taskId: task_id, body }) => {
  const dependsOnId = Number((body as { depends_on_id?: unknown } | null)?.depends_on_id);
  if (!Number.isSafeInteger(dependsOnId) || dependsOnId <= 0 || dependsOnId === task_id) {
    return NextResponse.json({ error: "task_id and depends_on_id are required (distinct)" }, { status: 400 });
  }
  const toAuth = await requireTaskPermission(req, dependsOnId, "edit");
  if (!toAuth.ok) return NextResponse.json({ error: toAuth.error }, { status: toAuth.status });
  await withTransaction(async (q) => {
    // Edges can cross projects. Lock the graph until the cycle check and insert commit.
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas:task-dependencies', 0))");
    const cycle = await q.query(
      `WITH RECURSIVE chain(id) AS (
         SELECT $2::bigint
         UNION
         SELECT d.depends_on_id
           FROM task_dependencies d
           JOIN chain c ON d.task_id = c.id
       )
       SELECT 1 FROM chain WHERE id = $1::bigint LIMIT 1`,
      [task_id, dependsOnId],
    );
    if ((cycle.rowCount ?? 0) > 0) throw conflict("dependency cycle");
    await q.query(
      "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING",
      [task_id, dependsOnId],
    );
  });
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
