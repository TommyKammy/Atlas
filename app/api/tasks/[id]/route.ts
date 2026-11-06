import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

const PATCHABLE = new Set([
  "name",
  "description",
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
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const taskProjectId = await getTaskProjectId(Number(id));
  if (taskProjectId !== null) {
    const auth = await requireProjectPermission(req, taskProjectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = await req.json();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    values.push(v === "" ? null : v);
    sets.push(`${k} = $${values.length}`);
  }
  if (typeof body.completed === "boolean") {
    sets.push(body.completed ? "completed_at = now()" : "completed_at = NULL");
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });
  }
  const uid = getCurrentUserIdFromRequest(req);
  const expected = (body as Record<string, unknown>).expected_updated_at;
  if (typeof expected === "string" && expected !== "") {
    const cur = await db.query("SELECT updated_at::text AS u FROM tasks WHERE id = $1::bigint", [id]);
    if (cur.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (cur.rows[0].u !== expected) {
      const snap = await db.query(
        `SELECT t.name, t.completed, t.assignee_id, u.name AS assignee_name,
           t.start_on::text AS start_on, t.due_on::text AS due_on,
           t.progress, t.status, t.description, t.section_id,
           t.updated_at::text AS updated_at
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.id = $1::bigint`,
        [id],
      );
      return NextResponse.json(
        { error: "conflict", updated_at: cur.rows[0].u, current: snap.rows[0] ?? null },
        { status: 409 },
      );
    }
  }
  const before = await db.query(
    "SELECT name, completed, assignee_id, start_on::text AS start_on, due_on::text AS due_on FROM tasks WHERE id = $1::bigint",
    [id],
  );
  values.push(id);
  const r = await db.query(
    `UPDATE tasks SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint RETURNING id`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const log = (kind: string, summary: string) =>
    logEvent(Number(id), uid, kind, summary).catch(() => undefined);
  const b = body as Record<string, unknown>;
  const prev = before.rows[0] as
    | {
        name: string;
        completed: boolean;
        assignee_id: number | null;
        start_on: string | null;
        due_on: string | null;
      }
    | undefined;
  const full = (
    await db.query(
      `SELECT project_id, section_id, parent_task_id, name, description, assignee_id,
         start_on::text AS start_on, due_on::text AS due_on, progress, status, recurrence
       FROM tasks WHERE id = $1::bigint`,
      [id],
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
      }
    | undefined;
  const shiftDate = (iso: string, rec: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (rec === "daily") d.setUTCDate(d.getUTCDate() + 1);
    else if (rec === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else {
      const day = d.getUTCDate();
      d.setUTCMonth(d.getUTCMonth() + 1);
      if (d.getUTCDate() < day) d.setUTCDate(0);
    }
    return d.toISOString().slice(0, 10);
  };
  if (prev) {
    if (typeof b.completed === "boolean" && b.completed !== prev.completed) {
      await log(b.completed ? "completed" : "reopened", b.completed ? "タスクを完了しました" : "タスクを未完了に戻しました");
      if (b.completed && full && full.parent_task_id === null && full.recurrence !== "none") {
        const rec = full.recurrence;
        await db.query(
          `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, assignee_id,
             start_on, due_on, progress, status, recurrence, position)
           VALUES ($1, $2, NULL, $3, $4, $5, $6::date, $7::date, 0, $8, $9,
             COALESCE((SELECT MAX(position) FROM tasks WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1) AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1) AND parent_task_id IS NULL), 0) + 1000)`,
          [
            full.project_id,
            full.section_id,
            full.name,
            full.description,
            full.assignee_id,
            full.start_on ? shiftDate(full.start_on, rec) : null,
            full.due_on ? shiftDate(full.due_on, rec) : null,
            full.status,
            rec,
          ],
        );
        await logEvent(Number(id), uid, "recurrence_spawned", "次回のタスクを生成しました").catch(() => undefined);
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
  }
  await notifyTask(id);
  await audit(uid, "task.update", { entity: "task", entityId: id, summary: Object.keys(b).join(",") });
  return NextResponse.json({ id: Number(id) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const taskProjectId = await getTaskProjectId(Number(id));
  if (taskProjectId !== null) {
    const auth = await requireProjectPermission(req, taskProjectId, "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (force) {
    const r = await db.query("DELETE FROM tasks WHERE id = $1::bigint", [id]);
    if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    await notifyTask(id);
    await audit(getCurrentUserIdFromRequest(req), "task.purge", { entity: "task", entityId: id });
    return NextResponse.json({ deleted: Number(id) });
  }
  const r = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL
       UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
     ) UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(id);
  await audit(getCurrentUserIdFromRequest(req), "task.delete", { entity: "task", entityId: id });
  await logEvent(Number(id), getCurrentUserIdFromRequest(req), "deleted", "タスクをゴミ箱に入れました").catch(() => undefined);
  return NextResponse.json({ deleted: Number(id) });
}
