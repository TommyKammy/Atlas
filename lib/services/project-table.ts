import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { TASK_CUSTOM_VALUE_PAIRS, type TaskCustomValuePairs } from "@/lib/repositories/task-custom-value-pairs";

type TableTask = {
  id: number;
  section_id: number | null;
  parent_task_id: number | null;
  name: string;
  assignee: string | null;
  start_on: string | null;
  due_on: string | null;
  completed: boolean;
  status: string;
  progress: number;
  custom_values: TaskCustomValuePairs;
};

/** Snapshot project tasks and custom fields into a standalone table. */
export async function createProjectTable({ projectId, uid, body, canArchiveSource }: {
  projectId: number;
  uid: number;
  body: unknown;
  canArchiveSource: boolean;
}) {
  const payload = (body ?? {}) as {
    name?: unknown;
    include_tasks?: unknown;
    archive_source?: unknown;
  };
  const project = await db.query("SELECT name, description FROM projects WHERE id = $1::bigint", [projectId]);
  if (project.rowCount === 0) return null;
  const name =
    typeof payload.name === "string" && payload.name.trim() !== ""
      ? payload.name.trim().slice(0, 120)
      : `${project.rows[0].name} テーブル`;
  const includeTasks = payload.include_tasks !== false;

  const fields = await db.query(
    `SELECT id, name, field_type FROM custom_fields
     WHERE project_id = $1::bigint AND deleted_at IS NULL ORDER BY position, id`,
    [projectId],
  );
  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  const sectionName = new Map(
    (sections.rows as { id: number; name: string }[]).map((section) => [Number(section.id), section.name]),
  );
  const fieldRows = fields.rows as { id: number; name: string; field_type: string }[];

  const columns = [
    { key: "section", label: "セクション", type: "text" },
    { key: "name", label: "名前", type: "text" },
    { key: "assignee", label: "担当者", type: "text" },
    { key: "start_on", label: "開始日", type: "date" },
    { key: "due_on", label: "期日", type: "date" },
    { key: "completed", label: "完了", type: "boolean" },
    { key: "progress", label: "進捗", type: "number" },
    { key: "status", label: "Status", type: "text" },
    ...fieldRows.map((field) => ({
      key: `cf_${field.id}`,
      label: field.name,
      type: field.field_type,
    })),
  ];

  const rows: unknown[][] = [];
  if (includeTasks) {
    const tasks = await db.query(
      `SELECT t.id, t.section_id, t.parent_task_id, t.name, u.name AS assignee,
         t.start_on::text AS start_on, t.due_on::text AS due_on,
         t.completed, t.status, t.progress, ${TASK_CUSTOM_VALUE_PAIRS}
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.project_id = $1::bigint AND t.deleted_at IS NULL
       ORDER BY t.position, t.id
       LIMIT 5000`,
      [projectId],
    );
    for (const task of tasks.rows as TableTask[]) {
      const values = new Map(task.custom_values ?? []);
      rows.push([
        task.section_id === null ? "" : (sectionName.get(Number(task.section_id)) ?? ""),
        task.parent_task_id === null ? task.name : `↳ ${task.name}`,
        task.assignee ?? "",
        task.start_on ?? "",
        task.due_on ?? "",
        task.completed ? "完了" : "未完了",
        task.progress,
        task.status,
        ...fieldRows.map((field) => values.get(String(field.id)) ?? ""),
      ]);
    }
  }

  const archived = payload.archive_source === true && canArchiveSource;
  const table = await withTransaction(async (q) => {
    const result = await q.query(
      `INSERT INTO project_tables (project_id, name, columns, rows, options, created_by)
       VALUES ($1::bigint, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::bigint)
       RETURNING id, created_at::text AS created_at`,
      [
        projectId,
        name,
        JSON.stringify(columns),
        JSON.stringify(rows),
        JSON.stringify({ include_tasks: includeTasks, source_project_name: project.rows[0].name }),
        uid,
      ],
    );
    if (archived) {
      await q.query(
        "UPDATE projects SET archived_at = COALESCE(archived_at, now()) WHERE id = $1::bigint",
        [projectId],
      );
    }
    return result.rows[0];
  });
  const tableId = Number(table.id);

  await audit(uid, "project.table_create", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `table ${tableId}, rows ${rows.length}`,
  });
  return {
    id: tableId,
    name,
    row_count: rows.length,
    column_count: columns.length,
    archived_source: archived,
    created_at: table.created_at,
  };
}
