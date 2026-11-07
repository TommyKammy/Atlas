import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

type Item = { task_id: number; position: number; due_on: string | null };

export const PUT = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const raw = Array.isArray(body?.items) ? body.items : null;
  if (!raw || raw.length === 0 || raw.length > 500) {
    return NextResponse.json({ error: "items (1-500) are required" }, { status: 400 });
  }
  const items: Item[] = [];
  const seen = new Set<number>();
  for (const entry of raw as unknown[]) {
    const record = entry as Record<string, unknown>;
    const taskId = Number(record?.task_id);
    const position = Number(record?.position);
    const due = record?.due_on;
    if (
      !Number.isInteger(taskId) ||
      taskId <= 0 ||
      !Number.isFinite(position) ||
      (due !== null && (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due))) ||
      seen.has(taskId)
    ) {
      return NextResponse.json({ error: "invalid item" }, { status: 400 });
    }
    seen.add(taskId);
    items.push({ task_id: taskId, position, due_on: due as string | null });
  }
  const ids = items.map((item) => item.task_id);
  const owned = await db.query(
    `SELECT id FROM tasks
     WHERE assignee_id = $1 AND completed = FALSE AND parent_task_id IS NULL
       AND deleted_at IS NULL AND id = ANY($2::bigint[])`,
    [uid, ids],
  );
  if ((owned.rowCount ?? 0) !== ids.length) {
    return NextResponse.json({ error: "task is not assigned to the current user" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `INSERT INTO my_task_orders (user_id, task_id, position, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, task_id)
         DO UPDATE SET position = EXCLUDED.position, updated_at = now()`,
        [uid, item.task_id, item.position],
      );
      await client.query(
        `UPDATE tasks SET due_on = $2::date, updated_at = now()
         WHERE id = $1 AND assignee_id = $3 AND deleted_at IS NULL`,
        [item.task_id, item.due_on, uid],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return NextResponse.json({ ok: true, count: items.length });
});
