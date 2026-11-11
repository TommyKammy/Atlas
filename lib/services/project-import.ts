import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { parseCsv } from "@/lib/csv";
import { canEditCustomField, isReadOnlyFieldType, normalizeAccessLevel, type CustomFieldType } from "@/lib/custom-fields";
import { normalizeFieldEditorIds } from "@/lib/field-access";
import { canManageProject, type ProjectRole } from "@/lib/project-roles";
import { receiveMultipart } from "@/lib/api/multipart";
import { text as readText } from "node:stream/consumers";
import { forbidden } from "@/lib/api/errors";
import { getProjectPolicyAccess } from "@/lib/project-policy-access";

const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const ROW_SAVEPOINT = "atlas_import_row";

/**
 * Import the CSV dialect produced by GET export (same column order).
 * Rows with 種別=サブタスク attach to the preceding top-level row.
 */
export async function importProject(
  req: Request,
  { uid, projectId, role }: { uid: number; projectId: number; role: ProjectRole },
): Promise<Response> {

  const { file: text } = await receiveMultipart(req, MAX_BYTES, "file exceeds 5MB", readText);
  if (text === undefined) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const records = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (records.length < 2) return NextResponse.json({ error: "empty csv" }, { status: 400 });

  const header = records[0].map((cell) => cell.trim());
  const base = ["セクション", "種別", "名前", "完了", "担当者", "開始日", "期日", "進捗", "Status", "繰返し", "コメント"];
  for (let i = 0; i < base.length; i++) {
    if (header[i] !== base[i]) {
      return NextResponse.json({ error: `unexpected header col ${i}: ${header[i] ?? ""}` }, { status: 400 });
    }
  }
  const rowCount = records.length - 1;
  if (rowCount > MAX_ROWS) {
    return NextResponse.json({
      error: `CSV contains ${rowCount} data rows; the maximum is ${MAX_ROWS}. No rows were imported.`,
      max_rows: MAX_ROWS,
      received_rows: rowCount,
    }, { status: 400 });
  }
  const customNames = header.slice(base.length);

  const result = await withTransaction(async (q) => {
    const fields = await q.query(
      `SELECT id, name, field_type, access_level, editor_ids
       FROM custom_fields WHERE project_id = $1 AND deleted_at IS NULL
       ORDER BY id FOR SHARE`,
      [projectId],
    );
    const fieldByName = new Map(
      fields.rows.map((field) => [String(field.name), {
        id: Number(field.id),
        field_type: field.field_type as CustomFieldType,
        canWrite: canEditCustomField(
          { access_level: normalizeAccessLevel(field.access_level), editor_ids: normalizeFieldEditorIds(field.editor_ids) },
          { viewerId: uid, canEdit: true, canAdmin: canManageProject(role) },
        ),
      }]),
    );
    const users = await q.query("SELECT id, name FROM users");
    const userByName = new Map((users.rows as { id: number; name: string }[]).map((u) => [u.name, u.id]));
    const sections = await q.query("SELECT id, name FROM sections WHERE project_id = $1", [projectId]);
    const sectionByName = new Map(
      (sections.rows as { id: number; name: string }[]).map((s) => [s.name, s.id]),
    );
    const policy = await getProjectPolicyAccess(uid, projectId, q);
    if (!policy.canConfigure) {
      // Validate the whole file before the first row can create tasks or
      // values. Row-level savepoints must not turn a denied configuration
      // change into a successful partial import.
      if (customNames.some((name) => name !== "" && !fieldByName.has(name))) {
        throw forbidden("CSV contains unknown custom fields; project configuration permission is required");
      }
      const createsSection = records.slice(1).some((row) =>
        (row[1] ?? "").trim() !== "サブタスク" && (row[2] ?? "").trim() !== "" &&
        (row[0] ?? "").trim() !== "" && !sectionByName.has((row[0] ?? "").trim()));
      if (createsSection) throw forbidden("CSV would create a section; project configuration permission is required");
    }

    // Section creation stays outside the row savepoint. This preserves the
    // previous behavior where a failed row can leave an empty section behind.
    const asSection = async (name: string): Promise<number | null> => {
      if (name === "") return null;
      const hit = sectionByName.get(name);
      if (hit !== undefined) return hit;
      const r = await q.query(
        "INSERT INTO sections (project_id, name, position) VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM sections WHERE project_id = $1), 0) + 1000) RETURNING id",
        [projectId, name.slice(0, 255)],
      );
      sectionByName.set(name, r.rows[0].id);
      return r.rows[0].id as number;
    };

    const rollbackRow = async () => {
      await q.query(`ROLLBACK TO SAVEPOINT ${ROW_SAVEPOINT}`);
      await q.query(`RELEASE SAVEPOINT ${ROW_SAVEPOINT}`);
    };

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const createdIds: number[] = [];
    let lastTop: number | null = null;
    const rows = records.slice(1);

    for (let li = 0; li < rows.length; li++) {
      const cols = rows[li];
      const get = (i: number) => (cols[i] ?? "").trim();
      try {
        const kind = get(1);
        if (kind !== "サブタスク") lastTop = null;
        const name = get(2);
        if (name === "") {
          skipped++;
          continue;
        }
        if (kind !== "サブタスク") {
          const restricted = customNames.find((column, index) => {
            const field = fieldByName.get(column);
            return field && !field.canWrite && !isReadOnlyFieldType(field.field_type) &&
              get(base.length + index) !== "";
          });
          if (restricted !== undefined) throw new Error(`field access denied: ${restricted}`);
        }
        const completed = get(3) === "完了";
        const assigneeId = get(4) === "" ? null : (userByName.get(get(4)) ?? null);
        const progress = Math.max(0, Math.min(100, Number(get(7)) || 0));
        const status = get(8) === "" ? "inbox" : get(8).slice(0, 64);
        const recRaw = get(9);
        const recurrence =
          recRaw === "daily" || recRaw === "weekly" || recRaw === "monthly" ? recRaw : "none";
        const dateOrNull = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

        if (kind === "サブタスク") {
          if (lastTop === null) {
            skipped++;
            errors.push(`line ${li + 2}: subtask without parent`);
            continue;
          }
          await q.query(`SAVEPOINT ${ROW_SAVEPOINT}`);
          try {
            await q.query(
              `INSERT INTO tasks (project_id, section_id, parent_task_id, name, position)
               VALUES ($1, (SELECT section_id FROM tasks WHERE id = $2), $2, $3,
                 COALESCE((SELECT MAX(position) FROM tasks WHERE parent_task_id = $2), 0) + 1000)`,
              [projectId, lastTop, name.slice(0, 255)],
            );
            await q.query(`RELEASE SAVEPOINT ${ROW_SAVEPOINT}`);
          } catch (error) {
            await rollbackRow();
            throw error;
          }
          created++;
          continue;
        }

        const sectionId = await asSection(get(0));
        await q.query(`SAVEPOINT ${ROW_SAVEPOINT}`);
        let newId: number;
        try {
          const r = await q.query(
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
          newId = Number(r.rows[0].id);
          const comment = get(10);
          if (comment !== "") {
            await q.query("INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)", [
              newId,
              uid,
              comment.slice(0, 5000),
            ]);
          }
          for (let ci = 0; ci < customNames.length; ci++) {
            const f = fieldByName.get(customNames[ci]);
            const raw = (cols[base.length + ci] ?? "").trim();
            if (!f || raw === "") continue;
            const fieldType = f.field_type;
            if (fieldType === "number" || fieldType === "timer") {
              const n = Number(raw);
              if (!Number.isFinite(n)) continue;
              await q.query(
                "INSERT INTO task_custom_values (task_id, field_id, value_number) VALUES ($1, $2, $3) ON CONFLICT (task_id, field_id) DO UPDATE SET value_number = EXCLUDED.value_number",
                [newId, f.id, n],
              );
            } else if (fieldType === "date") {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
              await q.query(
                "INSERT INTO task_custom_values (task_id, field_id, value_text, value_date) VALUES ($1, $2, $3, $4::date) ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text, value_date = EXCLUDED.value_date",
                [newId, f.id, raw, raw],
              );
            } else if (fieldType === "multi_select") {
              let selected: string[] = [];
              try {
                const parsed = JSON.parse(raw);
                selected = Array.isArray(parsed)
                  ? parsed.map((item) => String(item))
                  : raw.split(",").map((item) => item.trim()).filter((item) => item !== "");
              } catch {
                selected = raw.split(",").map((item) => item.trim()).filter((item) => item !== "");
              }
              if (selected.length === 0) continue;
              await q.query(
                "INSERT INTO task_custom_values (task_id, field_id, value_text, value_json) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text, value_json = EXCLUDED.value_json",
                [newId, f.id, selected.join(", "), JSON.stringify(selected)],
              );
            } else if (fieldType === "people") {
              const names = raw.split(",").map((item) => item.trim()).filter((item) => item !== "");
              const ids = names
                .map((name) => userByName.get(name))
                .filter((id): id is number => id !== undefined);
              if (ids.length > 0) {
                await q.query(
                  "INSERT INTO task_custom_values (task_id, field_id, value_text, value_json) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text, value_json = EXCLUDED.value_json",
                  [newId, f.id, names.join(", "), JSON.stringify(ids)],
                );
              }
            } else if (isReadOnlyFieldType(fieldType)) {
              continue;
            } else {
              await q.query(
                "INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, $3) ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text",
                [newId, f.id, raw.slice(0, 1000)],
              );
            }
          }
          await q.query(`RELEASE SAVEPOINT ${ROW_SAVEPOINT}`);
        } catch (error) {
          await rollbackRow();
          throw error;
        }
        lastTop = newId;
        createdIds.push(newId);
        created++;
      } catch (e) {
        skipped++;
        errors.push(`line ${li + 2}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    if (createdIds.length > 0) {
      await q.query(
        `INSERT INTO task_events (task_id, actor_id, kind, summary)
         SELECT id, $2::bigint, 'created', 'タスクをインポートで作成しました'
         FROM tasks WHERE id = ANY($1::bigint[])`,
        [createdIds, uid],
      );
    }
    return { created, skipped, errors: errors.slice(0, 20) };
  });

  await notifyProject(projectId);
  return NextResponse.json(result, { status: 201 });
}
