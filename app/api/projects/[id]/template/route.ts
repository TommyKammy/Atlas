import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { getProjectTaskForest, type ProjectTaskForestNode } from "@/lib/project-task-forest";

type SnapshotValue = {
  field_index: number;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
};

type SnapshotNode = {
  name: string;
  description: string;
  description_doc: unknown;
  assignee_id: number | null;
  status: string;
  progress: number;
  due_offset_days: number | null;
  start_offset_days: number | null;
  subtasks: SnapshotNode[];
  values: SnapshotValue[];
};

function offsetDays(iso: string | null, today: string): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/** Save a project as a reusable v2 template (sections, nested tasks, fields, values). */
export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as {
    name?: unknown;
    include_tasks?: unknown;
    include_completed?: unknown;
    include_custom_fields?: unknown;
  };
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 100) : "";
  if (!name) throw badRequest("name is required");
  const includeTasks = payload.include_tasks !== false;
  const includeCompleted = payload.include_completed === true;
  const includeCustomFields = payload.include_custom_fields !== false;
  const today = todayISO();

  const projectResult = await db.query(
    `SELECT workspace_id, name, description, color, icon, status, status_color,
       status_options, status_field_name, status_field_enabled,
       owner_id, team_id, settings
     FROM projects WHERE id = $1::bigint`,
    [projectId],
  );
  const project = projectResult.rows[0];

  const sectionsResult = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  const fieldsResult = includeCustomFields
    ? await db.query(
        `SELECT id, name, field_type, options, description, config, position, access_level, editor_ids
         FROM custom_fields WHERE project_id = $1::bigint AND deleted_at IS NULL ORDER BY position, id`,
        [projectId],
      )
    : { rows: [] as Record<string, unknown>[] };
  const fieldIndex = new Map<number, number>();
  (fieldsResult.rows as { id: number }[]).forEach((field, index) => fieldIndex.set(Number(field.id), index));

  const tasks: ProjectTaskForestNode[] = includeTasks ? await getProjectTaskForest(db, projectId) : [];
  const taskIds = tasks.map((t) => Number(t.id));
  const valuesByTask = new Map<number, SnapshotValue[]>();
  if (includeCustomFields && taskIds.length > 0) {
    const valuesResult = await db.query(
      `SELECT task_id, field_id, value_text, value_number, value_date::text AS value_date, value_json
       FROM task_custom_values WHERE task_id = ANY($1::bigint[])`,
      [taskIds],
    );
    for (const value of valuesResult.rows as {
      task_id: number;
      field_id: number;
      value_text: string | null;
      value_number: number | null;
      value_date: string | null;
      value_json: unknown;
    }[]) {
      const index = fieldIndex.get(Number(value.field_id));
      if (index === undefined) continue;
      const list = valuesByTask.get(Number(value.task_id)) ?? [];
      list.push({
        field_index: index,
        value_text: value.value_text,
        value_number: value.value_number,
        value_date: value.value_date,
        value_json: value.value_json,
      });
      valuesByTask.set(Number(value.task_id), list);
    }
  }

  const taskIdSet = new Set(tasks.map((task) => Number(task.id)));
  const children = new Map<number | null, ProjectTaskForestNode[]>();
  for (const task of tasks) {
    const key = task.parent_task_id === null ? null : Number(task.parent_task_id);
    const list = children.get(key) ?? [];
    list.push(task);
    children.set(key, list);
  }
  const toNode = (task: ProjectTaskForestNode): SnapshotNode | null => {
    if (task.completed && !includeCompleted) return null;
    const subtasks = (children.get(Number(task.id)) ?? [])
      .map(toNode)
      .filter((node): node is SnapshotNode => node !== null);
    return {
      name: task.name,
      description: task.description ?? "",
      description_doc: task.description_doc ?? null,
      assignee_id: task.assignee_id === null ? null : Number(task.assignee_id),
      status: task.status ?? "inbox",
      progress: Number(task.progress ?? 0),
      due_offset_days: offsetDays(task.due_on, today),
      start_offset_days: offsetDays(task.start_on, today),
      subtasks,
      values: valuesByTask.get(Number(task.id)) ?? [],
    };
  };

  const sectionRows = sectionsResult.rows as { id: number; name: string }[];
  const tasksBySection = new Map<number | null, SnapshotNode[]>();
  for (const task of tasks) {
    if (task.parent_task_id !== null && taskIdSet.has(Number(task.parent_task_id))) continue;
    const node = toNode(task);
    if (!node) continue;
    const key = task.effective_section_id === null ? null : Number(task.effective_section_id);
    const list = tasksBySection.get(key) ?? [];
    list.push(node);
    tasksBySection.set(key, list);
  }
  const sectionIds = new Set(sectionRows.map((section) => Number(section.id)));
  const payloadSections = sectionRows.map((section) => ({
    name: section.name,
    tasks: tasksBySection.get(Number(section.id)) ?? [],
  }));
  const unclassified: SnapshotNode[] = [];
  for (const [sectionId, list] of tasksBySection) {
    if (sectionId === null || !sectionIds.has(sectionId)) unclassified.push(...list);
  }
  if (unclassified.length > 0) {
    payloadSections.push({ name: "未分類", tasks: unclassified });
  }

  const templatePayload = {
    version: 2,
    project: {
      name: project.name,
      description: project.description ?? "",
      color: project.color ?? null,
      icon: project.icon ?? null,
      status: project.status ?? "active",
      status_color: project.status_color ?? "none",
      status_options: project.status_options ?? [],
      status_field_name: project.status_field_name ?? "Status",
      status_field_enabled: project.status_field_enabled !== false,
      owner_id: project.owner_id === null ? null : Number(project.owner_id),
      team_id: project.team_id === null ? null : Number(project.team_id),
      settings: project.settings ?? {},
    },
    sections: payloadSections,
    custom_fields: (fieldsResult.rows as {
      name: string;
      field_type: string;
      options: unknown;
      description: string;
      config: unknown;
      position: number;
      access_level: string;
      editor_ids: unknown;
    }[]).map((field) => ({
      name: field.name,
      field_type: field.field_type,
      options: field.options ?? [],
      description: field.description ?? "",
      config: field.config ?? {},
      position: field.position ?? 0,
      access_level: field.access_level ?? "everyone",
      editor_ids: field.editor_ids ?? [],
    })),
  };

  const inserted = await db.query(
    "INSERT INTO project_templates (workspace_id, name, payload, created_by) VALUES ($1::bigint, $2, $3::jsonb, $4::bigint) RETURNING id",
    [project.workspace_id, name, JSON.stringify(templatePayload), uid],
  );
  await audit(uid, "project.template_save", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: name,
  });
  return NextResponse.json({ id: Number(inserted.rows[0].id), version: 2 }, { status: 201 });
}, { body: true });
