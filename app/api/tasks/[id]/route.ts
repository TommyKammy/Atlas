import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";
import { withTask } from "@/lib/api/route";
import { runAutomations } from "@/lib/automation-runner";
import { emitTaskEvent } from "@/lib/domain/events";
import { validateRichTextDoc } from "@/lib/rich-text-validation";
import { normalizeMentionLabels } from "@/lib/mentions";
import { docToMarkdown } from "@/lib/rich-text-markdown";
import { insertNextOccurrence, validateTaskPatch } from "@/lib/services/task-write";

const PATCHABLE = new Set([
  "name",
  "description",
  "description_doc",
  "assignee_id",
  "completed",
  "start_on",
  "due_on",
  "progress",
  "status",
  "section_id",
  "position",
  "project_id",
  "parent_task_id",
  "recurrence",
  "is_milestone",
]);

export const PATCH = withTask("edit", async (req, { taskId, uid, projectId: currentProjectId }) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Validate the destination before touching the row. This closes the
  // cross-project move hole where only the source project was authorized.
  const rawProject = body.project_id;
  const targetProjectId =
    rawProject === undefined
      ? currentProjectId
      : rawProject === null || rawProject === ""
        ? null
        : Number(rawProject);
  if (targetProjectId === null || !Number.isInteger(targetProjectId) || targetProjectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  if (targetProjectId !== currentProjectId) {
    const targetAuth = await requireProjectPermission(req, targetProjectId, "edit");
    if (!targetAuth.ok) return NextResponse.json({ error: targetAuth.error }, { status: targetAuth.status });
    if (!("section_id" in body)) body.section_id = null;
    if (!("parent_task_id" in body)) body.parent_task_id = null;
  }
  if ("section_id" in body) {
    const rawSection = body.section_id;
    if (rawSection === null || rawSection === "") {
      body.section_id = null;
    } else {
      const sectionId = Number(rawSection);
      if (!Number.isInteger(sectionId) || sectionId <= 0) {
        return NextResponse.json({ error: "invalid section_id" }, { status: 400 });
      }
      const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
      if (section.rowCount === 0 || Number(section.rows[0].project_id) !== targetProjectId) {
        return NextResponse.json({ error: "section does not belong to project" }, { status: 400 });
      }
      body.section_id = sectionId;
    }
  }
  if ("parent_task_id" in body) {
    const rawParent = body.parent_task_id;
    if (rawParent === null || rawParent === "") {
      body.parent_task_id = null;
    } else {
      const parentId = Number(rawParent);
      if (!Number.isInteger(parentId) || parentId <= 0 || parentId === taskId) {
        return NextResponse.json({ error: "invalid parent_task_id" }, { status: 400 });
      }
      const parentProjectId = await getTaskProjectId(parentId);
      if (parentProjectId !== targetProjectId) {
        return NextResponse.json({ error: "parent task is in another project" }, { status: 400 });
      }
      const cycle = await db.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM tasks WHERE parent_task_id = $1::bigint
           UNION ALL SELECT t.id FROM tasks t JOIN descendants d ON t.parent_task_id = d.id
         ) SELECT 1 FROM descendants WHERE id = $2::bigint LIMIT 1`,
        [taskId, parentId],
      );
      if ((cycle.rowCount ?? 0) > 0) {
        return NextResponse.json({ error: "parent task cycle" }, { status: 400 });
      }
      body.parent_task_id = parentId;
    }
  }
  if ("assignee_id" in body) {
    const rawAssignee = body.assignee_id;
    if (rawAssignee === null || rawAssignee === "") {
      body.assignee_id = null;
    } else {
      const assigneeId = Number(rawAssignee);
      if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
        return NextResponse.json({ error: "invalid assignee_id" }, { status: 400 });
      }
      const user = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [assigneeId]);
      if (user.rowCount === 0) {
        return NextResponse.json({ error: "assignee not found" }, { status: 400 });
      }
      body.assignee_id = assigneeId;
    }
  }
  if ("project_id" in body) body.project_id = targetProjectId;

  if ("description_doc" in body) {
    if (body.description_doc === null) {
      body.description = "";
    } else {
      const parsed = validateRichTextDoc(body.description_doc, {
        maxBytes: 256_000,
        maxChars: 50_000,
        maxNodes: 4_000,
        maxDepth: 20,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: `invalid description_doc: ${parsed.error}` }, { status: 400 });
      }
      const normalized = await normalizeMentionLabels(parsed.doc, targetProjectId);
      body.description_doc = normalized;
      body.description = docToMarkdown(normalized);
    }
  } else if ("description" in body) {
    // Legacy markdown edits invalidate a stale rich-text document.
    body.description_doc = null;
  }

  const currentRow = await db.query(
    "SELECT start_on::text AS start_on, due_on::text AS due_on FROM tasks WHERE id = $1::bigint",
    [taskId],
  );
  if (currentRow.rowCount === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const validated = validateTaskPatch(body, {
    start_on: (currentRow.rows[0].start_on as string | null) ?? null,
    due_on: (currentRow.rows[0].due_on as string | null) ?? null,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  Object.assign(body, validated.values);

  // Milestones are top-level tasks. Keep the two fields consistent whichever
  // one the caller sends first.
  if (body.is_milestone === true) {
    body.parent_task_id = null;
  } else if ("parent_task_id" in body && body.parent_task_id !== null) {
    body.is_milestone = false;
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    values.push(v === "" && k !== "description" ? null : v);
    sets.push(`${k} = $${values.length}`);
  }
  if (typeof body.completed === "boolean") {
    sets.push(body.completed ? "completed_at = now()" : "completed_at = NULL");
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });
  }
  const expected = body.expected_updated_at;
  const conflictResponse = async () => {
    const cur = await db.query("SELECT updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const snap = await db.query(
      `SELECT t.name, t.completed, t.assignee_id, u.name AS assignee_name,
         t.start_on::text AS start_on, t.due_on::text AS due_on,
         t.progress, t.status, t.description, t.section_id, t.is_milestone,
         t.updated_at::text AS updated_at
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1::bigint`,
      [taskId],
    );
    return NextResponse.json(
      { error: "conflict", updated_at: cur.rows[0].u, current: snap.rows[0] ?? null },
      { status: 409 },
    );
  };
  if (typeof expected === "string" && expected !== "") {
    const cur = await db.query("SELECT updated_at::text AS u FROM tasks WHERE id = $1::bigint", [taskId]);
    if (cur.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (cur.rows[0].u !== expected) return conflictResponse();
  }
  const before = await db.query(
    "SELECT name, completed, assignee_id, status, section_id, start_on::text AS start_on, due_on::text AS due_on, is_milestone FROM tasks WHERE id = $1::bigint",
    [taskId],
  );
  values.push(taskId);
  let where = `id = $${values.length}::bigint`;
  if (typeof expected === "string" && expected !== "") {
    values.push(expected);
    where += ` AND updated_at = $${values.length}::timestamptz`;
  }
  const r = await db.query(
    `UPDATE tasks SET ${sets.join(", ")}, updated_at = now() WHERE ${where} RETURNING id`,
    values,
  );
  if (r.rowCount === 0) {
    return typeof expected === "string" && expected !== ""
      ? conflictResponse()
      : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const log = (kind: string, summary: string) =>
    logEvent(taskId, uid, kind, summary).catch(() => undefined);
  const b = body as Record<string, unknown>;
  const prev = before.rows[0] as
    | {
        name: string;
        completed: boolean;
        assignee_id: number | null;
        status: string;
        section_id: number | null;
        start_on: string | null;
        due_on: string | null;
        is_milestone: boolean;
      }
    | undefined;
  if (prev) {
    const nextSection =
      "section_id" in b
        ? b.section_id === null || b.section_id === ""
          ? null
          : Number(b.section_id)
        : prev.section_id;
    if (
      ("section_id" in b && nextSection !== prev.section_id) ||
      targetProjectId !== currentProjectId
    ) {
      await db
        .query("DELETE FROM task_timeline_rows WHERE task_id = $1::bigint", [taskId])
        .catch(() => undefined);
    }
  }
  const full = (
    await db.query(
      `SELECT project_id, section_id, parent_task_id, name, description, assignee_id,
         start_on::text AS start_on, due_on::text AS due_on, progress, status, recurrence,
         is_milestone
       FROM tasks WHERE id = $1::bigint`,
      [taskId],
    )
  ).rows[0] as
    | {
        project_id: number | null;
        section_id: number | null;
        parent_task_id: number | null;
        name: string;
        description: string;
        assignee_id: number | null;
        start_on: string | null;
        due_on: string | null;
        progress: number;
        status: string;
        recurrence: string;
        is_milestone: boolean;
      }
    | undefined;
  if (prev) {
    if (typeof b.completed === "boolean" && b.completed !== prev.completed) {
      await log(b.completed ? "completed" : "reopened", b.completed ? "タスクを完了しました" : "タスクを未完了に戻しました");
      if (b.completed && full && full.parent_task_id === null && full.recurrence !== "none") {
        const nextTaskId = await insertNextOccurrence(db, full);
        await logEvent(taskId, uid, "recurrence_spawned", "次回のタスクを生成しました").catch(() => undefined);
        if (nextTaskId !== null) {
          await emitTaskEvent({
            projectId: targetProjectId,
            taskId: nextTaskId,
            actorId: uid,
            type: "task.created",
            data: { recurrence: true, from_task_id: taskId },
          }).catch(() => undefined);
        }
      }
    }
    if ("assignee_id" in b) {
      const next = b.assignee_id === "" || b.assignee_id === null ? null : Number(b.assignee_id);
      if (next !== prev.assignee_id) {
        let who = "担当者を外しました";
        if (next !== null) {
          const u = await db.query("SELECT name FROM users WHERE id = $1", [next]);
          who = `担当者を${u.rows[0]?.name ?? `ID:${next}`}に変更しました`;
        }
        await log("assignee_changed", who);
      }
    }
    if ("start_on" in b) {
      const next = b.start_on === "" || b.start_on === null ? null : String(b.start_on);
      if (next !== prev.start_on) {
        await log("start_changed", next ? `開始日を${next}に設定しました` : "開始日をクリアしました");
      }
    }
    if ("due_on" in b) {
      const next = b.due_on === "" || b.due_on === null ? null : String(b.due_on);
      if (next !== prev.due_on) {
        await log("due_changed", next ? `期日を${next}に設定しました` : "期日をクリアしました");
      }
    }
    if (typeof b.name === "string" && b.name.trim() !== "" && b.name.trim() !== prev.name) {
      await log("renamed", "タスク名を変更しました");
    }
    if (typeof b.is_milestone === "boolean" && b.is_milestone !== prev.is_milestone) {
      await log(
        "type_changed",
        b.is_milestone ? "マイルストーンに変換しました" : "タスクに変換しました",
      );
    }
    if (b.completed === true && prev.completed === false) {
      await runAutomations(targetProjectId, taskId, "task_completed").catch(() => undefined);
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.completed",
        data: { previous: false, next: true },
      }).catch(() => undefined);
    }
    if (b.completed === false && prev.completed === true) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.reopened",
        data: { previous: true, next: false },
      }).catch(() => undefined);
    }
    if ("assignee_id" in b) {
      const next = b.assignee_id === "" || b.assignee_id === null ? null : Number(b.assignee_id);
      if (next !== prev.assignee_id) {
        await emitTaskEvent({
          projectId: targetProjectId,
          taskId,
          actorId: uid,
          type: "task.assigned",
          data: { previous_assignee_id: prev.assignee_id, assignee_id: next },
        }).catch(() => undefined);
      }
    }
    if ("due_on" in b) {
      const next = b.due_on === "" || b.due_on === null ? null : String(b.due_on);
      if (next !== prev.due_on) {
        await emitTaskEvent({
          projectId: targetProjectId,
          taskId,
          actorId: uid,
          type: "task.due_changed",
          data: { previous_due_on: prev.due_on, due_on: next },
        }).catch(() => undefined);
      }
    }
    if ("section_id" in b) {
      const next = b.section_id === "" || b.section_id === null ? null : Number(b.section_id);
      if (next !== prev.section_id) {
        await emitTaskEvent({
          projectId: targetProjectId,
          taskId,
          actorId: uid,
          type: "task.section_changed",
          data: { previous_section_id: prev.section_id, section_id: next },
        }).catch(() => undefined);
      }
    }
    if (typeof b.is_milestone === "boolean" && b.is_milestone !== prev.is_milestone) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.milestone_changed",
        data: { previous: prev.is_milestone, is_milestone: b.is_milestone },
      }).catch(() => undefined);
    }
    if (typeof b.status === "string" && b.status !== prev.status) {
      await runAutomations(targetProjectId, taskId, "status_changed").catch(() => undefined);
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.status_changed",
        data: { previous_status: prev.status, status: b.status },
      }).catch(() => undefined);
    }
    if (targetProjectId !== currentProjectId) {
      await emitTaskEvent({
        projectId: targetProjectId,
        taskId,
        actorId: uid,
        type: "task.added_to_project",
        data: { previous_project_id: currentProjectId, project_id: targetProjectId },
      }).catch(() => undefined);
    }
  }
  await notifyTask(taskId);
  await audit(uid, "task.update", { entity: "task", entityId: taskId, summary: Object.keys(b).join(",") });
  return NextResponse.json({ id: taskId });
});

export const DELETE = withTask("edit", async (req, { taskId, uid, projectId }) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (force) {
    const r = await db.query("DELETE FROM tasks WHERE id = $1::bigint", [taskId]);
    if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    await notifyTask(taskId);
    await audit(uid, "task.purge", { entity: "task", entityId: taskId, projectId: projectId ?? undefined });
    return NextResponse.json({ deleted: taskId });
  }
  const r = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL
       UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
     ) UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
    [taskId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(taskId);
  await audit(uid, "task.delete", { entity: "task", entityId: taskId, projectId: projectId ?? undefined });
  await logEvent(taskId, uid, "deleted", "タスクをゴミ箱に入れました").catch(() => undefined);
  return NextResponse.json({ deleted: taskId });
});
