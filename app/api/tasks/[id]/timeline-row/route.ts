import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";

/** Pin or unpin one task's timeline row for a project. */
export const PUT = withUser(async (req, { uid, params }) => {
  const taskId = Number(params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId = Number(body.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const belongs = await db.query(
    `SELECT 1 FROM tasks t
     WHERE t.id = $1::bigint AND t.deleted_at IS NULL
       AND (
         t.project_id = $2::bigint
         OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $2::bigint
         )
       )`,
    [taskId, projectId],
  );
  if (belongs.rowCount === 0) {
    return NextResponse.json({ error: "task not found in project" }, { status: 404 });
  }

  if (!("row_index" in body)) {
    return NextResponse.json({ error: "row_index is required" }, { status: 400 });
  }
  const expected =
    typeof body.expected_updated_at === "string" && body.expected_updated_at !== ""
      ? body.expected_updated_at
      : null;
  if (expected !== null) {
    const current = await db.query(
      "SELECT updated_at::text AS updated_at FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
      [taskId, projectId],
    );
    if ((current.rowCount ?? 0) > 0 && current.rows[0].updated_at !== expected) {
      return NextResponse.json(
        { error: "conflict", updated_at: current.rows[0].updated_at },
        { status: 409 },
      );
    }
  }
  const rawRow = body.row_index;
  if (rawRow === null || rawRow === "") {
    await db.query(
      "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
      [taskId, projectId],
    );
    await audit(uid, "task.timeline_row", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: "auto",
    });
    await notifyProject(projectId);
    return NextResponse.json({
      task_id: taskId,
      project_id: projectId,
      row_index: null,
      updated_at: null,
    });
  }

  const rowIndex = Number(rawRow);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 200) {
    return NextResponse.json({ error: "invalid row_index" }, { status: 400 });
  }
  const saved = await db.query(
    `INSERT INTO task_timeline_rows (task_id, project_id, row_index, updated_by, updated_at)
     VALUES ($1::bigint, $2::bigint, $3, $4::bigint, now())
     ON CONFLICT (task_id, project_id) DO UPDATE SET
       row_index = EXCLUDED.row_index,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING updated_at::text AS updated_at`,
    [taskId, projectId, rowIndex, uid],
  );
  await audit(uid, "task.timeline_row", {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: `row ${rowIndex}`,
  });
  await notifyProject(projectId);
  return NextResponse.json({
    task_id: taskId,
    project_id: projectId,
    row_index: rowIndex,
    updated_at: saved.rows[0]?.updated_at ?? null,
  });
});
