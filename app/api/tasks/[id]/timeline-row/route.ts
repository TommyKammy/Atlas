import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { notFound } from "@/lib/api/errors";
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

  if (!("row_index" in body)) {
    return NextResponse.json({ error: "row_index is required" }, { status: 400 });
  }
  // Omission keeps the legacy unconditional write. Explicit null means the
  // caller saw an automatic row, so another user's first pin is a conflict.
  const expected = body.expected_updated_at;
  if (expected !== undefined && expected !== null && (typeof expected !== "string" || expected === "")) {
    return NextResponse.json({ error: "invalid expected_updated_at" }, { status: 400 });
  }
  const rawRow = body.row_index;
  const rowIndex = rawRow === null || rawRow === "" ? null : Number(rawRow);
  if (rowIndex !== null && (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 200)) {
    return NextResponse.json({ error: "invalid row_index" }, { status: 400 });
  }

  const result = await withTransaction(async (q) => {
    // Membership removal, section changes, and pinning serialize on the task.
    // Read the membership after obtaining the lock, using a fresh statement snapshot.
    const task = await q.query(
      "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
      [taskId],
    );
    if (!task.rows[0]) throw notFound("task not found in project");
    if (task.rows[0].project_id !== projectId) {
      const membership = await q.query(
        "SELECT 1 FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
      if (membership.rowCount === 0) throw notFound("task not found in project");
    }

    const currentStamp = async () => {
      const current = await q.query<{ updated_at: string }>(
        "SELECT updated_at::text AS updated_at FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
      return current.rows[0]?.updated_at ?? null;
    };

    if (rowIndex === null) {
      if (expected === null) {
        const stamp = await currentStamp();
        return { ok: stamp === null, stamp };
      }
      const cleared = await q.query(
        `DELETE FROM task_timeline_rows
         WHERE task_id = $1::bigint AND project_id = $2::bigint
           AND ($3::text IS NULL OR updated_at::text = $3)`,
        [taskId, projectId, expected ?? null],
      );
      if (expected !== undefined && cleared.rowCount === 0) {
        return { ok: false, stamp: await currentStamp() };
      }
      return { ok: true, stamp: null };
    }

    const saved = typeof expected === "string"
      ? await q.query<{ updated_at: string }>(
          `UPDATE task_timeline_rows SET row_index = $3, updated_by = $4::bigint,
             updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
           WHERE task_id = $1::bigint AND project_id = $2::bigint AND updated_at::text = $5
           RETURNING updated_at::text AS updated_at`,
          [taskId, projectId, rowIndex, uid, expected],
        )
      : await q.query<{ updated_at: string }>(
          `INSERT INTO task_timeline_rows (task_id, project_id, row_index, updated_by, updated_at)
           VALUES ($1::bigint, $2::bigint, $3, $4::bigint, clock_timestamp())
           ON CONFLICT (task_id, project_id) ${expected === null ? "DO NOTHING" : `DO UPDATE SET
             row_index = EXCLUDED.row_index, updated_by = EXCLUDED.updated_by,
             updated_at = GREATEST(clock_timestamp(), task_timeline_rows.updated_at + interval '1 microsecond')`}
           RETURNING updated_at::text AS updated_at`,
          [taskId, projectId, rowIndex, uid],
        );
    if (!saved.rows[0]) return { ok: false, stamp: await currentStamp() };
    return { ok: true, stamp: saved.rows[0].updated_at };
  });
  if (!result.ok) {
    return NextResponse.json({ error: "conflict", updated_at: result.stamp }, { status: 409 });
  }

  await audit(uid, "task.timeline_row", {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: rowIndex === null ? "auto" : `row ${rowIndex}`,
  });
  await notifyProject(projectId);
  return NextResponse.json({
    task_id: taskId,
    project_id: projectId,
    row_index: rowIndex,
    updated_at: result.stamp,
  });
});
