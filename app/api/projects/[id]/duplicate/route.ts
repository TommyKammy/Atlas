import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { ensureDefaultProjectTabs } from "@/lib/repositories/projects";
import { getProjectTaskForest } from "@/lib/project-task-forest";

type DuplicateBody = {
  name?: unknown;
  include_tasks?: unknown;
  include_completed?: unknown;
  include_subtasks?: unknown;
  include_fields?: unknown;
  include_members?: unknown;
};

/**
 * Duplicate a project's structure. The copy is independent: sections, tasks,
 * custom fields/values and members are recreated with new ids.
 */
export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const payload = (body ?? {}) as DuplicateBody;
    const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 100) : "";
    if (!name) throw badRequest("name is required");
    const includeTasks = payload.include_tasks !== false;
    const includeCompleted = payload.include_completed !== false;
    const includeSubtasks = payload.include_subtasks !== false;
    const includeFields = payload.include_fields !== false;
    const includeMembers = payload.include_members !== false;

    const newProjectId = await withTransaction(async (q) => {
      const srcResult = await q.query("SELECT * FROM projects WHERE id = $1::bigint", [projectId]);
      const src = srcResult.rows[0] as Record<string, unknown>;
      const projectInsert = await q.query(
        `INSERT INTO projects (
           workspace_id, name, description, icon, color, status, status_color,
           status_options, status_field_name, status_field_enabled,
           owner_id, team_id, due_on, settings
         ) VALUES (
           $1::bigint, $2, $3, $4, $5, $6, $7,
           $8::jsonb, $9, $10,
           $11, $12, $13::date, $14::jsonb
         ) RETURNING id`,
        [
          src.workspace_id,
          name,
          src.description ?? "",
          src.icon ?? null,
          src.color ?? null,
          src.status ?? "active",
          src.status_color ?? "none",
          JSON.stringify(src.status_options ?? ["未着手", "進行中", "Done"]),
          src.status_field_name ?? "Status",
          src.status_field_enabled !== false,
          src.owner_id ?? null,
          src.team_id ?? null,
          src.due_on ?? null,
          JSON.stringify(src.settings ?? {}),
        ],
      );
      const newId = Number(projectInsert.rows[0].id);

      // Members: preserve the source roster, always keep the actor as admin.
      if (includeMembers) {
        const members = await q.query(
          "SELECT user_id, role FROM project_members WHERE project_id = $1::bigint",
          [projectId],
        );
        for (const member of members.rows as { user_id: number; role: string }[]) {
          await q.query(
            `INSERT INTO project_members (project_id, user_id, role) VALUES ($1::bigint, $2::bigint, $3)
             ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [newId, member.user_id, member.role],
          );
        }
      }
      await q.query(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1::bigint, $2::bigint, 'admin')
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin'`,
        [newId, uid],
      );

      // Sections.
      const sections = await q.query(
        "SELECT id, name, position FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
        [projectId],
      );
      const sectionMap = new Map<number, number>();
      for (const section of sections.rows as { id: number; name: string; position: number }[]) {
        const inserted = await q.query(
          "INSERT INTO sections (project_id, name, position) VALUES ($1::bigint, $2, $3) RETURNING id",
          [newId, section.name, section.position],
        );
        sectionMap.set(Number(section.id), Number(inserted.rows[0].id));
      }

      // Custom fields (definitions) and values.
      const fieldMap = new Map<number, number>();
      if (includeFields) {
        const fields = await q.query(
          `SELECT id, name, field_type, options, description, config,
             position, access_level, editor_ids
           FROM custom_fields
           WHERE project_id = $1::bigint AND deleted_at IS NULL
           ORDER BY position, id`,
          [projectId],
        );
        for (const field of fields.rows as {
          id: number;
          name: string;
          field_type: string;
          options: unknown;
          description: string;
          config: unknown;
          position: number;
          access_level: string;
          editor_ids: unknown;
        }[]) {
          const inserted = await q.query(
            `INSERT INTO custom_fields (
               project_id, name, field_type, options, description, config,
               position, access_level, editor_ids
             ) VALUES ($1::bigint, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb)
             RETURNING id`,
            [
              newId,
              field.name,
              field.field_type,
              JSON.stringify(field.options ?? []),
              field.description ?? "",
              JSON.stringify(field.config ?? {}),
              field.position ?? 0,
              field.access_level ?? "everyone",
              JSON.stringify(field.editor_ids ?? []),
            ],
          );
          fieldMap.set(Number(field.id), Number(inserted.rows[0].id));
        }
      }

      // Automation rules are copied as new rules owned by the duplicating user.
      const sourceRules = await q.query(
        `SELECT name, description, definition, enabled
         FROM project_rules WHERE project_id = $1::bigint ORDER BY id LIMIT 50`,
        [projectId],
      );
      for (const rule of sourceRules.rows as {
        name: string;
        description: string;
        definition: unknown;
        enabled: boolean;
      }[]) {
        await q.query(
          `INSERT INTO project_rules (
             workspace_id, project_id, name, description, definition, owner_id, enabled
           ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint, $7)`,
          [
            src.workspace_id,
            newId,
            rule.name,
            rule.description ?? "",
            JSON.stringify(rule.definition ?? {}),
            uid,
            rule.enabled !== false,
          ],
        );
      }

      // Tasks visible in the source project, including secondary multi-homes.
      const taskMap = new Map<number, number>();
      if (includeTasks) {
        const sourceTasks = await getProjectTaskForest(q, projectId);
        if (sourceTasks.length > 5000) throw badRequest("project has too many tasks to duplicate (max 5000)");
        for (const task of sourceTasks) {
          if (task.completed && !includeCompleted) continue;
          if (task.parent_task_id !== null && !includeSubtasks) continue;
          if (task.parent_task_id !== null && !taskMap.has(task.parent_task_id)) continue;
          const effectiveSection = task.effective_section_id;
          const inserted = await q.query(
            `INSERT INTO tasks (
               project_id, section_id, parent_task_id, name, description, description_doc,
               assignee_id, created_by, completed, completed_at, start_on, due_on,
               progress, status, position, recurrence
             ) VALUES (
               $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
               $7::bigint, $8::bigint, $9, $10::timestamptz, $11::date, $12::date,
               $13, $14, $15, $16
             ) RETURNING id`,
            [
              newId,
              effectiveSection === null ? null : (sectionMap.get(Number(effectiveSection)) ?? null),
              task.parent_task_id === null ? null : (taskMap.get(task.parent_task_id) ?? null),
              task.name,
              task.description ?? "",
              task.description_doc === null || task.description_doc === undefined
                ? null
                : JSON.stringify(task.description_doc),
              task.assignee_id,
              uid,
              task.completed,
              task.completed_at,
              task.start_on,
              task.due_on,
              task.progress ?? 0,
              task.status ?? "inbox",
              task.position ?? 0,
              task.recurrence ?? "none",
            ],
          );
          const newTaskId = Number(inserted.rows[0].id);
          taskMap.set(Number(task.id), newTaskId);

          if (fieldMap.size > 0) {
            const values = await q.query(
              `SELECT field_id, value_text, value_number, value_date::text AS value_date, value_json
               FROM task_custom_values WHERE task_id = $1::bigint`,
              [task.id],
            );
            for (const value of values.rows as {
              field_id: number;
              value_text: string | null;
              value_number: number | null;
              value_date: string | null;
              value_json: unknown;
            }[]) {
              const mappedField = fieldMap.get(Number(value.field_id));
              if (!mappedField) continue;
              await q.query(
                `INSERT INTO task_custom_values (task_id, field_id, value_text, value_number, value_date, value_json)
                 VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6::jsonb)
                 ON CONFLICT (task_id, field_id) DO UPDATE SET
                   value_text = EXCLUDED.value_text,
                   value_number = EXCLUDED.value_number,
                   value_date = EXCLUDED.value_date,
                   value_json = EXCLUDED.value_json`,
                [
                  newTaskId,
                  mappedField,
                  value.value_text,
                  value.value_number,
                  value.value_date,
                  value.value_json === null || value.value_json === undefined
                    ? null
                    : JSON.stringify(value.value_json),
                ],
              );
            }
          }
        }
      }

      await ensureDefaultProjectTabs(newId, q);
      return newId;
    });

    await audit(uid, "project.duplicate", {
      entity: "project",
      entityId: newProjectId,
      projectId: newProjectId,
      summary: `duplicated from ${projectId}`,
    });
    return NextResponse.json({ id: newProjectId, source_project_id: projectId }, { status: 201 });
  },
  { body: true },
);
