import { NextResponse } from "next/server";
import { todayISO } from "@/lib/dates";
import { shiftDate } from "@/lib/timeline-dnd";
import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { withAdmin, withUser } from "@/lib/api/route";
import { ensureDefaultProjectTabs } from "@/lib/repositories/projects";

type TemplateValue = {
  field_index: number;
  value_text?: string | null;
  value_number?: number | null;
  value_date?: string | null;
  value_json?: unknown;
};

type TemplateTask = {
  name?: string;
  description?: string;
  description_doc?: unknown;
  assignee_id?: number | null;
  due_offset_days?: number | null;
  start_offset_days?: number | null;
  status?: string;
  progress?: number;
  subtasks?: TemplateTask[];
  values?: TemplateValue[];
};

type TemplateField = {
  name?: string;
  field_type?: string;
  options?: unknown;
  description?: string;
  config?: unknown;
  position?: number;
  access_level?: string;
  editor_ids?: unknown;
};

type V2Payload = {
  version?: number;
  project?: {
    description?: string;
    color?: string | null;
    icon?: string | null;
    status?: string;
    status_color?: string;
    status_options?: string[];
    status_field_name?: string;
    status_field_enabled?: boolean;
    owner_id?: number | null;
    team_id?: number | null;
    settings?: unknown;
  };
  sections?: { name?: string; tasks?: TemplateTask[] }[];
  custom_fields?: TemplateField[];
};

export const DELETE = withAdmin(async (_req, { params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM project_templates WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: Number(id) });
});

// Instantiate a template into a new project. Body: { name: string }.
export const POST = withUser(async (req, { uid, params }) => {
  const id = params.id;
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const t = await db.query("SELECT workspace_id, payload FROM project_templates WHERE id = $1::bigint", [id]);
  if (t.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const workspaceId = Number(t.rows[0].workspace_id);
  const payload = t.rows[0].payload as V2Payload;

  const projectId = await withTransaction(async (q) => {
    const isV2 = payload?.version === 2;
    const meta = isV2 ? payload.project ?? {} : {};
    let ownerId: number | null = null;
    if (typeof meta.owner_id === "number" && Number.isInteger(meta.owner_id)) {
      const owner = await q.query(
        "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
        [meta.owner_id],
      );
      if ((owner.rowCount ?? 0) > 0) ownerId = Number(meta.owner_id);
    }
    let teamId: number | null = null;
    if (typeof meta.team_id === "number" && Number.isInteger(meta.team_id)) {
      const team = await q.query(
        "SELECT id FROM teams WHERE id = $1::bigint AND workspace_id = $2::bigint",
        [meta.team_id, workspaceId],
      );
      if ((team.rowCount ?? 0) > 0) teamId = Number(meta.team_id);
    }
    const inserted = await q.query(
      `INSERT INTO projects (
         workspace_id, name, description, color, icon, status, status_color,
         status_options, status_field_name, status_field_enabled,
         owner_id, team_id, settings
       ) VALUES (
         $1::bigint, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9, $10,
         $11::bigint, $12::bigint, $13::jsonb
       ) RETURNING id`,
      [
        workspaceId,
        name,
        typeof meta.description === "string" ? meta.description : "",
        meta.color ?? null,
        meta.icon ?? null,
        typeof meta.status === "string" ? meta.status : "active",
        typeof meta.status_color === "string" ? meta.status_color : "none",
        JSON.stringify(Array.isArray(meta.status_options) ? meta.status_options : ["未着手", "進行中", "Done"]),
        typeof meta.status_field_name === "string" ? meta.status_field_name : "Status",
        meta.status_field_enabled !== false,
        ownerId,
        teamId,
        JSON.stringify(meta.settings ?? {}),
      ],
    );
    const newId = Number(inserted.rows[0].id);
    await q.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1::bigint, $2::bigint, 'admin') ON CONFLICT DO NOTHING",
      [newId, uid],
    );

    const fieldMap = new Map<number, number>();
    if (isV2) {
      const fields = Array.isArray(payload.custom_fields) ? payload.custom_fields.slice(0, 100) : [];
      for (const [index, field] of fields.entries()) {
        if (typeof field?.name !== "string" || field.name.trim() === "") continue;
        const created = await q.query(
          `INSERT INTO custom_fields (
             project_id, name, field_type, options, description, config, position, access_level, editor_ids
           ) VALUES ($1::bigint, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb)
           RETURNING id`,
          [
            newId,
            field.name.trim().slice(0, 100),
            typeof field.field_type === "string" ? field.field_type : "text",
            JSON.stringify(Array.isArray(field.options) ? field.options : []),
            typeof field.description === "string" ? field.description : "",
            JSON.stringify(field.config ?? {}),
            Number.isFinite(Number(field.position)) ? Number(field.position) : index * 1000,
            field.access_level === "admins" || field.access_level === "custom" ? field.access_level : "everyone",
            JSON.stringify(Array.isArray(field.editor_ids) ? field.editor_ids : []),
          ],
        );
        fieldMap.set(index, Number(created.rows[0].id));
      }
    }

    const createTask = async (
      task: TemplateTask,
      sectionId: number | null,
      parentId: number | null,
      position: number,
    ): Promise<void> => {
      if (typeof task?.name !== "string" || task.name.trim() === "") return;
      const due =
        typeof task.due_offset_days === "number" && Number.isFinite(task.due_offset_days)
          ? shiftDate(todayISO(), task.due_offset_days)
          : null;
      const start =
        typeof task.start_offset_days === "number" && Number.isFinite(task.start_offset_days)
          ? shiftDate(todayISO(), task.start_offset_days)
          : null;
      const created = await q.query(
        `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, description_doc,
           assignee_id, start_on, due_on, progress, status, position)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
           $7::bigint, $8::date, $9::date, $10, $11, $12)
         RETURNING id`,
        [
          newId,
          sectionId,
          parentId,
          task.name.trim().slice(0, 255),
          typeof task.description === "string" ? task.description : "",
          task.description_doc === null || task.description_doc === undefined
            ? null
            : JSON.stringify(task.description_doc),
          typeof task.assignee_id === "number" ? task.assignee_id : null,
          start,
          due,
          Math.max(0, Math.min(100, Number(task.progress ?? 0))),
          typeof task.status === "string" && task.status !== "" ? task.status.slice(0, 64) : "inbox",
          position,
        ],
      );
      const taskId = Number(created.rows[0].id);
      if (isV2 && Array.isArray(task.values)) {
        for (const value of task.values.slice(0, 100)) {
          const fieldId = fieldMap.get(Number(value.field_index));
          if (!fieldId) continue;
          await q.query(
            `INSERT INTO task_custom_values (task_id, field_id, value_text, value_number, value_date, value_json)
             VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6::jsonb)
             ON CONFLICT (task_id, field_id) DO NOTHING`,
            [
              taskId,
              fieldId,
              value.value_text ?? null,
              value.value_number ?? null,
              value.value_date ?? null,
              value.value_json === undefined ? null : JSON.stringify(value.value_json),
            ],
          );
        }
      }
      const subtasks = Array.isArray(task.subtasks) ? task.subtasks.slice(0, 200) : [];
      for (const [index, subtask] of subtasks.entries()) {
        await createTask(subtask, sectionId, taskId, (index + 1) * 1000);
      }
    };

    const sections = Array.isArray(payload.sections) ? payload.sections.slice(0, 50) : [];
    for (const [si, section] of sections.entries()) {
      if (typeof section?.name !== "string" || section.name.trim() === "") continue;
      const sec = await q.query(
        "INSERT INTO sections (project_id, name, position) VALUES ($1::bigint, $2, $3) RETURNING id",
        [newId, section.name.trim().slice(0, 255), (si + 1) * 1000],
      );
      const sectionId = Number(sec.rows[0].id);
      const tasks = Array.isArray(section.tasks) ? section.tasks.slice(0, 500) : [];
      for (const [ti, task] of tasks.entries()) {
        await createTask(task, sectionId, null, (ti + 1) * 1000);
      }
    }

    await ensureDefaultProjectTabs(newId, q);
    return newId;
  });

  await audit(uid, "project.template_use", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `template ${id}`,
  });
  await notifyProject(projectId);
  return NextResponse.json({ id: projectId }, { status: 201 });
});
