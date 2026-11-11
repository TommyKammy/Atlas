import type { TimelineRowPlacement } from "@/lib/timeline-row-drop";
import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { badRequest, notFound } from "@/lib/api/errors";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { emitTaskEvent } from "@/lib/domain/events";
import { lockAutomationProjectAccess } from "@/lib/project-automation-lock";
import { shiftDate } from "@/lib/timeline-dnd";
import { validateTaskPatch } from "@/lib/services/task-write";
import { logEvent } from "@/lib/repositories/tasks";

/** Save a project-local placement and an optional date shift in one write. */
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

  const hasSection = Object.hasOwn(body, "section_id");
  const sectionId = body.section_id as number | null;
  const expectedSection = body.expected_section_id as number | null;
  const expectedTask = body.expected_task_updated_at;
  if (hasSection) {
    if (sectionId !== null && (typeof sectionId !== "number" || !Number.isSafeInteger(sectionId) || sectionId <= 0)) {
      return NextResponse.json({ error: "invalid section_id" }, { status: 400 });
    }
    if (!Object.hasOwn(body, "expected_section_id") ||
        (expectedSection !== null && (typeof expectedSection !== "number" || !Number.isSafeInteger(expectedSection) || expectedSection <= 0))) {
      return NextResponse.json({ error: "invalid expected_section_id" }, { status: 400 });
    }
    if (typeof expectedTask !== "string" || expectedTask === "" || !Object.hasOwn(body, "expected_updated_at")) {
      return NextResponse.json({ error: "section placement requires task, section and row versions" }, { status: 400 });
    }
  }

  const dateDelta = body.date_delta ?? 0;
  if (Object.hasOwn(body, "date_delta") && (!hasSection || rowIndex === null ||
      typeof body.date_delta !== "number" || !Number.isSafeInteger(dateDelta) || Math.abs(dateDelta as number) > 3_660_000)) {
    return NextResponse.json({ error: "invalid date_delta or missing placement preconditions" }, { status: 400 });
  }

  const placements = body.placements as TimelineRowPlacement[] | undefined;
  if (placements !== undefined) {
    if (!hasSection || rowIndex === null || !Array.isArray(placements) || placements.length > 5000 ||
        placements.some((p) => !p || typeof p !== "object" || !Number.isSafeInteger(p.task_id) || p.task_id <= 0 ||
          p.task_id === taskId || !Number.isInteger(p.row_index) || p.row_index < 0 || p.row_index > 200 ||
          typeof p.expected_task_updated_at !== "string" || !p.expected_task_updated_at ||
          !(p.expected_updated_at === null || typeof p.expected_updated_at === "string" && p.expected_updated_at.length > 0)) ||
        new Set(placements.map((p) => p.task_id)).size !== placements.length) {
      return NextResponse.json({ error: "invalid placements" }, { status: 400 });
    }
  }

  const notifyProjects = new Set<number>([projectId]);
  const result = await withTransaction(async (q) => {
    // Deletion takes the exclusive gate before touching tasks/projects. A
    // section move also writes a project-scoped outbox event and must not take
    // that project's FK lock after deletion has begun waiting for this task.
    if (hasSection) {
      await lockAutomationProjectAccess(q);
      // Section deletion locks its section before the FK actions lock tasks or
      // memberships. Take the observed source and target in stable order first,
      // including same-section pinning, to avoid the reverse lock order.
      const sectionIds = [...new Set([expectedSection, sectionId].filter((id): id is number => id !== null))]
        .sort((a, b) => a - b);
      if (sectionIds.length) {
        const sections = await q.query<{ id: number }>(
          "SELECT id FROM sections WHERE project_id = $1::bigint AND id = ANY($2::bigint[]) ORDER BY id FOR KEY SHARE",
          [projectId, sectionIds],
        );
        const locked = new Set(sections.rows.map((section) => section.id));
        if (sectionId !== null && !locked.has(sectionId)) {
          return { ok: false, stamp: null, invalidSection: true };
        }
        if (expectedSection !== null && !locked.has(expectedSection)) {
          return { ok: false, stamp: null };
        }
      }
    }
    if (placements?.length) {
      // All placement writers serialize on tasks. Acquire the complete set in
      // ascending order before locking the dragged task or writing any pins.
      const ids = [taskId, ...placements.map((p) => p.task_id)].sort((a, b) => a - b);
      const locked = await q.query("SELECT id FROM tasks WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE", [ids]);
      if (locked.rowCount !== ids.length) throw notFound("placement task not found");
    }
    // Membership removal, section changes, and pinning serialize on the task.
    // Read the membership after obtaining the lock, using a fresh statement snapshot.
    const task = await q.query(
      hasSection
        ? "SELECT project_id, section_id, start_on::text AS start_on, due_on::text AS due_on, updated_at::text AS updated_at FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE"
        : "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
      [taskId],
    );
    if (!task.rows[0]) throw notFound("task not found in project");
    const primary = task.rows[0].project_id === projectId;
    let previousSection: number | null = task.rows[0].section_id ?? null;
    if (!primary) {
      const membership = await q.query(
        hasSection
          ? "SELECT section_id FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE"
          : "SELECT 1 FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
      if (membership.rowCount === 0) throw notFound("task not found in project");
      previousSection = membership.rows[0].section_id ?? null;
    }

    const currentStamp = async () => {
      const current = await q.query<{ updated_at: string }>(
        "SELECT updated_at::text AS updated_at FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
      return current.rows[0]?.updated_at ?? null;
    };

    if (hasSection) {
      // Membership writes do not all bump tasks.updated_at, so the source
      // section is a separate precondition in addition to task and pin stamps.
      if (task.rows[0].updated_at !== expectedTask || previousSection !== expectedSection ||
          await currentStamp() !== expected) {
        return { ok: false, stamp: await currentStamp() };
      }
    }

    if (placements?.length) {
      const peers = await q.query<{
        id: number; section_id: number | null; task_stamp: string; pin_stamp: string | null;
      }>(
        `SELECT t.id, CASE WHEN t.project_id=$2::bigint THEN t.section_id ELSE m.section_id END AS section_id,
           t.updated_at::text AS task_stamp, r.updated_at::text AS pin_stamp
         FROM tasks t LEFT JOIN task_project_memberships m ON m.task_id=t.id AND m.project_id=$2::bigint
         LEFT JOIN task_timeline_rows r ON r.task_id=t.id AND r.project_id=$2::bigint
         WHERE t.id=ANY($1::bigint[]) AND (t.project_id=$2::bigint OR m.task_id IS NOT NULL)`,
        [placements.map((p) => p.task_id), projectId],
      );
      if (peers.rows.length !== placements.length) throw notFound("placement task not found in project");
      const byId = new Map(peers.rows.map((p) => [p.id, p]));
      if (placements.some((p) => {
        const current = byId.get(p.task_id)!;
        return current.section_id !== sectionId || current.task_stamp !== p.expected_task_updated_at || current.pin_stamp !== p.expected_updated_at;
      })) return { ok: false, stamp: await currentStamp() };
    }

    const previousDates = {
      start_on: task.rows[0].start_on as string | null,
      due_on: task.rows[0].due_on as string | null,
    };
    let nextDates = previousDates;
    if (dateDelta !== 0) {
      if (!previousDates.start_on && !previousDates.due_on) throw badRequest("cannot shift an undated task");
      try {
        nextDates = {
          start_on: previousDates.start_on === null ? null : shiftDate(previousDates.start_on, dateDelta as number),
          due_on: previousDates.due_on === null ? null : shiftDate(previousDates.due_on, dateDelta as number),
        };
      } catch {
        throw badRequest("invalid shifted dates");
      }
      const validation = validateTaskPatch(nextDates, previousDates);
      if (!validation.ok || Object.values(nextDates).some((date) => date?.startsWith("0000-"))) {
        throw badRequest("shifted dates must be valid dates between 0001 and 9999");
      }
    }

    const savePeers = async () => {
      if (!placements?.length) return;
      await q.query(
        `INSERT INTO task_timeline_rows (task_id, project_id, row_index, updated_by, updated_at)
         SELECT p.task_id, $2::bigint, p.row_index, $3::bigint, clock_timestamp()
         FROM jsonb_to_recordset($1::jsonb) AS p(task_id bigint, row_index integer)
         ORDER BY p.task_id
         ON CONFLICT (task_id, project_id) DO UPDATE SET row_index=EXCLUDED.row_index,
           updated_by=EXCLUDED.updated_by,
           updated_at=GREATEST(clock_timestamp(),task_timeline_rows.updated_at + interval '1 microsecond')
         WHERE task_timeline_rows.row_index IS DISTINCT FROM EXCLUDED.row_index`,
        [JSON.stringify(placements), projectId, uid],
      );
    };

    const moveTask = async () => {
      if (!hasSection) return undefined;
      const changed = previousSection !== sectionId;
      const datesChanged = nextDates.start_on !== previousDates.start_on || nextDates.due_on !== previousDates.due_on;
      if (primary) {
        // Some older import/copy paths retained a redundant primary membership.
        // Keep it in step without creating a second representation for new tasks.
        await q.query(
          "UPDATE task_project_memberships SET section_id = $3::bigint WHERE task_id = $1::bigint AND project_id = $2::bigint",
          [taskId, projectId, sectionId],
        );
      }
      if (!changed && !datesChanged) return task.rows[0].updated_at as string;
      if (!primary && changed) {
        await q.query(
          "UPDATE task_project_memberships SET section_id = $3::bigint WHERE task_id = $1::bigint AND project_id = $2::bigint",
          [taskId, projectId, sectionId],
        );
      }
      const updated = await q.query<{ updated_at: string }>(
        `UPDATE tasks SET section_id = CASE WHEN $2::boolean THEN $3::bigint ELSE section_id END,
           start_on = $4::date, due_on = $5::date,
           updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE id = $1::bigint RETURNING updated_at::text AS updated_at`,
        [taskId, primary, sectionId, nextDates.start_on, nextDates.due_on],
      );
      if (changed) await emitTaskEvent({
        projectId,
        taskId,
        actorId: uid,
        type: "task.section_changed",
        data: { previous_section_id: previousSection, section_id: sectionId },
      }, q);
      if (nextDates.start_on !== previousDates.start_on) {
        await logEvent(taskId, uid, "start_changed", `開始日を${nextDates.start_on}に設定しました`, q);
      }
      if (nextDates.due_on !== previousDates.due_on) {
        await logEvent(taskId, uid, "due_changed", `期日を${nextDates.due_on}に設定しました`, q);
        await emitTaskEvent({ projectId, taskId, actorId: uid, type: "task.due_changed",
          data: { previous_due_on: previousDates.due_on, due_on: nextDates.due_on } }, q);
      }
      if (datesChanged) {
        // Dates are shared across homes; all project views must refresh. Pins
        // and sections remain local to the project where the drop occurred.
        if (task.rows[0].project_id !== null) notifyProjects.add(task.rows[0].project_id);
        const homes = await q.query<{ project_id: number }>(
          "SELECT project_id FROM task_project_memberships WHERE task_id=$1::bigint", [taskId],
        );
        for (const home of homes.rows) notifyProjects.add(home.project_id);
      }
      return updated.rows[0].updated_at;
    };

    if (rowIndex === null) {
      if (expected === null) {
        const stamp = await currentStamp();
        if (stamp !== null) return { ok: false, stamp };
        return { ok: true, stamp, taskStamp: await moveTask() };
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
      return { ok: true, stamp: null, taskStamp: await moveTask() };
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
    await savePeers();
    return { ok: true, stamp: saved.rows[0].updated_at, taskStamp: await moveTask() };
  });
  if (!result.ok) {
    if ("invalidSection" in result) {
      return NextResponse.json({ error: "section does not belong to project" }, { status: 400 });
    }
    return NextResponse.json({ error: "conflict", updated_at: result.stamp }, { status: 409 });
  }

  await audit(uid, "task.timeline_row", {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: rowIndex === null ? "auto" : `row ${rowIndex}`,
  });
  await Promise.all([...notifyProjects].map((id) => notifyProject(id)));
  return NextResponse.json({
    task_id: taskId,
    project_id: projectId,
    row_index: rowIndex,
    updated_at: result.stamp,
    ...(hasSection ? { section_id: sectionId, task_updated_at: result.taskStamp } : {}),
  });
});
