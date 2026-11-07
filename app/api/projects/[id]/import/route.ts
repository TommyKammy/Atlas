import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { parseCsv } from "@/lib/csv";

const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

// Import the CSV dialect produced by GET export (same column order).
// Rows with 種別=サブタスク attach to the preceding top-level row.
export const POST = withProject("edit", async (req, { uid, projectId }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 5MB" }, { status: 413 });
  }
  const text = await file.text();
  const records = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (records.length < 2) return NextResponse.json({ error: "empty csv" }, { status: 400 });

  const header = records[0].map((cell) => cell.trim());
  const base = ["セクション", "種別", "名前", "完了", "担当者", "開始日", "期日", "進捗", "Status", "繰返し", "コメント"];
  for (let i = 0; i < base.length; i++) {
    if (header[i] !== base[i]) {
      return NextResponse.json({ error: `unexpected header col ${i}: ${header[i] ?? ""}` }, { status: 400 });
    }
  }
  const customNames = header.slice(base.length);
  const fields = await db.query("SELECT id, name, field_type FROM custom_fields WHERE project_id = $1", [projectId]);
  const fieldByName = new Map(
    (fields.rows as { id: number; name: string; field_type: string }[]).map((f) => [f.name, f]),
  );
  const users = await db.query("SELECT id, name FROM users");
  const userByName = new Map((users.rows as { id: number; name: string }[]).map((u) => [u.name, u.id]));
  const sections = await db.query("SELECT id, name FROM sections WHERE project_id = $1", [projectId]);
  const sectionByName = new Map((sections.rows as { id: number; name: string }[]).map((s) => [s.name, s.id]));

  const asSection = async (name: string): Promise<number | null> => {
    if (name === "") return null;
    const hit = sectionByName.get(name);
    if (hit !== undefined) return hit;
    const r = await db.query(
      "INSERT INTO sections (project_id, name, position) VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM sections WHERE project_id = $1), 0) + 1000) RETURNING id",
      [projectId, name.slice(0, 255)],
    );
    sectionByName.set(name, r.rows[0].id);
    return r.rows[0].id as number;
  };

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  let lastTop: number | null = null;
  const rows = records.slice(1, MAX_ROWS + 1);
  for (let li = 0; li < rows.length; li++) {
    const cols = rows[li];
    const get = (i: number) => (cols[i] ?? "").trim();
    try {
      const kind = get(1);
      const name = get(2);
      if (name === "") {
        skipped++;
        continue;
      }
      const completed = get(3) === "完了";
      const assigneeId = get(4) === "" ? null : (userByName.get(get(4)) ?? null);
      const progress = Math.max(0, Math.min(100, Number(get(7)) || 0));
      const status = get(8) === "" ? "inbox" : get(8).slice(0, 64);
      const recRaw = get(9);
      const recurrence = recRaw === "daily" || recRaw === "weekly" || recRaw === "monthly" ? recRaw : "none";
      const dateOrNull = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
      if (kind === "サブタスク") {
        if (lastTop === null) {
          skipped++;
          errors.push(`line ${li + 2}: subtask without parent`);
          continue;
        }
        await db.query(
          `INSERT INTO tasks (project_id, section_id, parent_task_id, name, position)
           VALUES ($1, (SELECT section_id FROM tasks WHERE id = $2), $2, $3,
             COALESCE((SELECT MAX(position) FROM tasks WHERE parent_task_id = $2), 0) + 1000)`,
          [projectId, lastTop, name.slice(0, 255)],
        );
        created++;
        continue;
      }
      const sectionId = await asSection(get(0));
      const r = await db.query(
        `INSERT INTO tasks (project_id, section_id, parent_task_id, name, assignee_id, completed,
           start_on, due_on, progress, status, recurrence, position)
         VALUES ($1, $2, NULL, $3, $4, $5, $6::date, $7::date, $8, $9, $10,
           COALESCE((SELECT MAX(position) FROM tasks
                     WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1)
                       AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
                       AND parent_task_id IS NULL), 0) + 1000)
         RETURNING id`,
        [
          projectId,
          sectionId,
          name.slice(0, 255),
          assigneeId,
          completed,
          dateOrNull(get(5)),
          dateOrNull(get(6)),
          progress,
          status,
          recurrence,
        ],
      );
      const newId = r.rows[0].id as number;
      lastTop = newId;
      const comment = get(10);
      if (comment !== "") {
        await db.query("INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)", [
          newId,
          uid,
          comment.slice(0, 5000),
        ]);
      }
      for (let ci = 0; ci < customNames.length; ci++) {
        const f = fieldByName.get(customNames[ci]);
        const raw = (cols[base.length + ci] ?? "").trim();
        if (!f || raw === "") continue;
        if (f.field_type === "number") {
          const n = Number(raw);
          if (!Number.isFinite(n)) continue;
          await db.query(
            "INSERT INTO task_custom_values (task_id, field_id, value_number) VALUES ($1, $2, $3) ON CONFLICT (task_id, field_id) DO UPDATE SET value_number = EXCLUDED.value_number",
            [newId, f.id, n],
          );
        } else {
          await db.query(
            "INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, $3) ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text",
            [newId, f.id, raw.slice(0, 1000)],
          );
        }
      }
      await logEvent(newId, uid, "created", "タスクをインポートで作成しました").catch(() => undefined);
      created++;
    } catch (e) {
      skipped++;
      errors.push(`line ${li + 2}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  await notifyProject(projectId);
  return NextResponse.json({ created, skipped, errors: errors.slice(0, 20) }, { status: 201 });
});
