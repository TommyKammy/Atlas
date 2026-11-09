import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { db } from "@/lib/db";
import { emitTaskEvent } from "@/lib/domain/events";
import { processPendingEvents } from "@/lib/automation/engine";

/** Manually trigger one rule against a task (Asana-style manual trigger). */
export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, params, body }) => {
    const ruleId = Number(params.ruleId);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
    }
    const rule = await db.query(
      "SELECT id FROM project_rules WHERE id = $1::bigint AND project_id = $2::bigint",
      [ruleId, projectId],
    );
    if (rule.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const payload = (body ?? {}) as { task_id?: unknown };
    const taskId = Number(payload.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }
    const task = await db.query(
      `SELECT t.id FROM tasks t
       WHERE t.id = $1::bigint AND t.deleted_at IS NULL
         AND (t.project_id = $2::bigint OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $2::bigint
         ))`,
      [taskId, projectId],
    );
    if (task.rowCount === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
    await emitTaskEvent({
      projectId,
      taskId,
      actorId: uid,
      type: "task.manual_rule",
      data: { target_rule_id: ruleId, manual: true },
      correlationId: `manual:${ruleId}:${taskId}:${Date.now()}`,
    });
    const result = await processPendingEvents(20);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  },
  { body: true },
);
