import { db } from "../db";
import type { Attachment, TaskRow } from "../data";
import {
  customValueToIdArray,
  formatCustomValue,
  formatNumberValue,
  normalizeCustomFieldConfig,
  type CustomField,
  type CustomValue,
} from "../custom-fields";
import { projectTaskScope } from "./scope";
import { TASK_FROM, TASK_SELECT_COLS, toTaskRow } from "./task-select";
import { ensureAutoIdValues } from "../auto-id";

export async function getProjectTasks(projectId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS},
       COALESCE(m.section_id, t.section_id) AS eff_section_id,
       tr.row_index AS timeline_row,
       tr.updated_at::text AS timeline_row_updated_at
     ${TASK_FROM}
     LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1
     LEFT JOIN task_timeline_rows tr ON tr.task_id = t.id AND tr.project_id = $1
     WHERE t.parent_task_id IS NULL AND t.deleted_at IS NULL
       AND (t.project_id = $1 OR m.task_id IS NOT NULL)
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return r.rows.map(toTaskRow);
}

/** Task scoped to a project the caller can already see (primary, multi-home, or subtask). */
export async function getTaskForProject(taskId: number, projectId: number) {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}, tr.row_index AS timeline_row, tr.updated_at::text AS timeline_row_updated_at
     ${TASK_FROM}
     LEFT JOIN task_timeline_rows tr ON tr.task_id = t.id AND tr.project_id = $2
     WHERE t.id = $1 AND t.deleted_at IS NULL
       AND (
         t.project_id = $2
         OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM tasks parent
           WHERE parent.id = t.parent_task_id
             AND (
               parent.project_id = $2
               OR EXISTS (
                 SELECT 1 FROM task_project_memberships pm
                 WHERE pm.task_id = parent.id AND pm.project_id = $2
               )
             )
         )
       )`,
    [taskId, projectId],
  );
  return r.rows[0] ? toTaskRow(r.rows[0] as TaskRow) : undefined;
}

export async function getSubtasks(taskId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS} ${TASK_FROM}
     WHERE t.parent_task_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [taskId],
  );
  return r.rows.map(toTaskRow);
}

export async function getMyTasks(userId: number): Promise<(TaskRow & { project_name: string | null })[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}
     ${TASK_FROM}
     LEFT JOIN my_task_orders o ON o.task_id = t.id AND o.user_id = $1
     WHERE t.assignee_id = $1 AND t.completed = FALSE
       AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY o.position NULLS LAST, t.due_on NULLS LAST, t.position, t.id`,
    [userId],
  );
  return r.rows.map((row) => ({ ...toTaskRow(row as TaskRow), project_name: row.project_name ?? null }));
}

export async function getDependencies(taskId: number) {
  const r = await db.query(
    "SELECT t.id, t.name FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = $1 ORDER BY t.id",
    [taskId],
  );
  return r.rows as { id: number; name: string }[];
}

export async function getProjectTaskOptions(projectId: number) {
  const r = await db.query(
    `SELECT t.id, t.name FROM tasks t
     WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return r.rows as { id: number; name: string }[];
}

export type TaskEventRow = {
  id: number;
  summary: string;
  actor_name: string | null;
  created_at: string;
};

export async function getTaskEvents(taskId: number): Promise<TaskEventRow[]> {
  const r = await db.query(
    `SELECT e.id, e.summary, u.name AS actor_name, e.created_at::text
     FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.task_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
    [taskId],
  );
  return r.rows;
}

export async function getSubtasksBulk(projectId: number): Promise<Record<number, TaskRow[]>> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}
     ${TASK_FROM}
     WHERE t.parent_task_id IS NOT NULL AND t.deleted_at IS NULL
       AND (
         t.project_id = $1
         OR EXISTS (
           SELECT 1 FROM tasks p
           JOIN task_project_memberships m ON m.task_id = p.id AND m.project_id = $1
           WHERE p.id = t.parent_task_id
         )
       )
     ORDER BY t.position, t.id`,
    [projectId],
  );
  const out: Record<number, TaskRow[]> = {};
  for (const row of r.rows.map(toTaskRow)) {
    const parent = Number(row.parent_task_id);
    if (!out[parent]) out[parent] = [];
    out[parent].push(row);
  }
  return out;
}

export async function getTaskDependencies(projectId: number) {
  const r = await db.query(
    `SELECT d.task_id, d.depends_on_id FROM task_dependencies d
     JOIN tasks t ON t.id = d.task_id WHERE ${projectTaskScope("t")}`,
    [projectId],
  );
  return r.rows as { task_id: number; depends_on_id: number }[];
}

export async function getTaskProjects(taskId: number) {
  const r = await db.query(
    `SELECT p.id, p.name, s.name AS section_name
     FROM task_project_memberships m
     JOIN projects p ON p.id = m.project_id
     LEFT JOIN sections s ON s.id = m.section_id
     WHERE m.task_id = $1
     UNION
     SELECT p.id, p.name, s.name AS section_name
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN sections s ON s.id = t.section_id
     WHERE t.id = $1 AND t.project_id IS NOT NULL`,
    [taskId],
  );
  return r.rows as { id: number; name: string; section_name: string | null }[];
}

export async function logEvent(taskId: number, actorId: number, kind: string, summary: string) {
  await db.query(
    "INSERT INTO task_events (task_id, actor_id, kind, summary) VALUES ($1, $2, $3, $4)",
    [taskId, actorId, kind, summary],
  );
}

export async function getTaskCustomValues(
  projectId: number,
): Promise<Record<number, Record<number, CustomValue>>> {
  await ensureAutoIdValues(projectId);
  const [valueRows, fieldRows, taskRows] = await Promise.all([
    db.query(
      `SELECT v.task_id, v.field_id, v.value_text, v.value_number,
         v.value_date::text AS value_date, v.value_json
       FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
       WHERE f.project_id = $1::bigint AND f.deleted_at IS NULL`,
      [projectId],
    ),
    db.query(
      `SELECT id, name, field_type, options, config
       FROM custom_fields WHERE project_id = $1::bigint AND deleted_at IS NULL ORDER BY position, id`,
      [projectId],
    ),
    db.query(
      `SELECT t.id, t.parent_task_id FROM tasks t
       WHERE (t.project_id = $1::bigint OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $1::bigint
         ))
         AND t.deleted_at IS NULL`,
      [projectId],
    ),
  ]);

  const out: Record<number, Record<number, CustomValue>> = {};
  for (const row of valueRows.rows) {
    if (!out[row.task_id]) out[row.task_id] = {};
    out[row.task_id][row.field_id] = {
      value_text: row.value_text,
      value_number: row.value_number,
      value_date: row.value_date,
      value_json: row.value_json,
    };
  }

  const fields: CustomField[] = fieldRows.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    field_type: row.field_type,
    options: (row.options ?? []) as string[],
    config: normalizeCustomFieldConfig(row.config),
  }));
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const taskIds = taskRows.rows.map((row) => Number(row.id));
  if (taskIds.length === 0) return out;

  const ensure = (taskId: number) => {
    if (!out[taskId]) out[taskId] = {};
    return out[taskId];
  };

  const referenceFields = fields.filter((field) => field.field_type === "reference");
  const referenceIdsByTask = new Map<number, Map<number, number[]>>();
  for (const field of referenceFields) {
    const perTask = new Map<number, number[]>();
    const allIds = new Set<number>();
    for (const taskId of taskIds) {
      const ids = customValueToIdArray(out[taskId]?.[field.id]);
      if (ids.length > 0) {
        perTask.set(taskId, ids);
        for (const id of ids) allIds.add(id);
      }
    }
    referenceIdsByTask.set(field.id, perTask);
    if (allIds.size === 0) continue;
    const names = await db.query(
      "SELECT id, name FROM tasks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL",
      [[...allIds]],
    );
    const nameById = new Map(names.rows.map((row) => [Number(row.id), String(row.name)]));
    for (const [taskId, ids] of perTask) {
      const namesForTask = ids.map((id) => nameById.get(id)).filter((name): name is string => Boolean(name));
      ensure(taskId)[field.id] = {
        ...out[taskId][field.id],
        value_text: namesForTask.length > 0 ? namesForTask.join(", ") : null,
      };
    }
  }

  const lookupFields = fields.filter((field) => field.field_type === "lookup");
  for (const field of lookupFields) {
    const refId = field.config?.reference_field_id;
    const targetId = field.config?.lookup_field_id;
    if (!refId || !targetId) continue;
    const perTask = referenceIdsByTask.get(refId);
    if (!perTask || perTask.size === 0) continue;
    const target = await loadFieldForComputation(targetId, fieldById);
    if (!target) continue;
    const allRefIds = new Set<number>();
    for (const ids of perTask.values()) for (const id of ids) allRefIds.add(id);
    const targetValues = await loadValuesForTasks(targetId, [...allRefIds]);
    for (const [taskId, ids] of perTask) {
      const formatted = ids
        .map((id) => {
          const value = targetValues.get(id);
          return value ? formatCustomValue(target, value) : null;
        })
        .filter((value): value is string => Boolean(value) && value !== "–");
      if (formatted.length > 0) {
        ensure(taskId)[field.id] = {
          value_text: formatted.join(", "),
          value_number: null,
          value_json: null,
        };
      }
    }
  }

  const rollupFields = fields.filter((field) => field.field_type === "rollup");
  for (const field of rollupFields) {
    const sourceFieldId = field.config?.rollup_field_id;
    if (!sourceFieldId) continue;
    const source = field.config?.rollup_source === "reference" ? "reference" : "subtasks";
    const mapping = new Map<number, number[]>();
    if (source === "subtasks") {
      const children = await db.query(
        `SELECT id, parent_task_id FROM tasks
         WHERE parent_task_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [taskIds],
      );
      for (const row of children.rows) {
        const parentId = Number(row.parent_task_id);
        if (!mapping.has(parentId)) mapping.set(parentId, []);
        mapping.get(parentId)!.push(Number(row.id));
      }
    } else {
      const refId = field.config?.reference_field_id;
      if (!refId) continue;
      for (const [taskId, ids] of referenceIdsByTask.get(refId) ?? []) mapping.set(taskId, ids);
    }
    if (mapping.size === 0) continue;
    const allSourceIds = new Set<number>();
    for (const ids of mapping.values()) for (const id of ids) allSourceIds.add(id);
    const target = await loadFieldForComputation(sourceFieldId, fieldById);
    if (!target) continue;
    const sourceValues = await loadValuesForTasks(sourceFieldId, [...allSourceIds]);
    const fn = field.config?.rollup_function ?? "sum";
    for (const [taskId, ids] of mapping) {
      const numbers = ids
        .map((id) => sourceValues.get(id)?.value_number)
        .map((value) => (value === null || value === undefined ? null : Number(value)))
        .filter((value): value is number => value !== null && Number.isFinite(value));
      if (fn !== "count" && numbers.length === 0) continue;
      let result = 0;
      if (fn === "count") result = numbers.length;
      else if (fn === "sum") result = numbers.reduce((sum, value) => sum + value, 0);
      else if (fn === "average") result = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      else if (fn === "min") result = Math.min(...numbers);
      else result = Math.max(...numbers);
      ensure(taskId)[field.id] = {
        value_text: formatNumberValue(result, target?.config ?? {}),
        value_number: result,
        value_json: null,
      };
    }
  }

  return out;
}

async function loadFieldForComputation(
  fieldId: number,
  known: Map<number, CustomField>,
): Promise<CustomField | undefined> {
  const existing = known.get(fieldId);
  if (existing) return existing;
  const r = await db.query(
    "SELECT id, name, field_type, options, config FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
    [fieldId],
  );
  if (r.rowCount === 0) return undefined;
  const row = r.rows[0];
  return {
    id: Number(row.id),
    name: row.name,
    field_type: row.field_type,
    options: (row.options ?? []) as string[],
    config: normalizeCustomFieldConfig(row.config),
  };
}

async function loadValuesForTasks(
  fieldId: number,
  taskIds: number[],
): Promise<Map<number, CustomValue>> {
  const out = new Map<number, CustomValue>();
  if (taskIds.length === 0) return out;
  const r = await db.query(
    `SELECT v.task_id, v.value_text, v.value_number, v.value_date::text AS value_date, v.value_json
     FROM task_custom_values v JOIN tasks t ON t.id = v.task_id AND t.deleted_at IS NULL
     WHERE v.field_id = $1::bigint AND v.task_id = ANY($2::bigint[])`,
    [fieldId, taskIds],
  );
  for (const row of r.rows) {
    out.set(Number(row.task_id), {
      value_text: row.value_text,
      value_number: row.value_number,
      value_date: row.value_date,
      value_json: row.value_json,
    });
  }
  return out;
}

export async function getTaskAttachments(taskId: number): Promise<Attachment[]> {
  const r = await db.query(
    `SELECT a.id, a.task_id, a.file_name, a.mime_type, a.size_bytes::int AS size_bytes,
       u.name AS author_name, a.created_at::text AS created_at
     FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.task_id = $1 ORDER BY a.id`,
    [taskId],
  );
  return r.rows;
}
