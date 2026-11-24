import { ApiError, badRequest, forbidden, notFound } from "../api/errors";
import { audit } from "../audit";
import { copyRuleWithoutWebhookCredentials } from "../automation/webhook-credentials";
import { todayISO } from "../dates";
import { db, withTransaction } from "../db";
import { notifyProject } from "../notify";
import { PROJECT_ICONS } from "../project-appearance";
import { projectPatchRequiresAdmin } from "../project-policy";
import { mergeProjectSettings } from "../project-settings";
import type { ProjectTemplatePayload, TemplateTask } from "../project-template-payload";
import { ensureDefaultProjectTabs } from "../repositories/projects";
import { shiftDate } from "../timeline-dnd";
import { requireProjectAccess, requireWorkspacePermission, type Actor } from "./actor";

/**
 * A status-options version conflict carries the current row so the REST route
 * can keep its flat 409 body. `jsonError` would nest these fields under
 * `details`, which the customize screen does not read.
 */
export class ProjectUpdateConflict extends ApiError {
  readonly current: Record<string, unknown>;

  constructor(current: Record<string, unknown>) {
    super(409, "status options changed", "conflict");
    this.name = "ProjectUpdateConflict";
    this.current = current;
  }
}

/**
 * Create an empty project for an actor that need not come from an HTTP session.
 * Permission order, validation messages and side effects mirror POST /api/projects.
 */
export async function createProject(actor: Actor, input: unknown): Promise<{ id: number }> {
  await requireWorkspacePermission(actor, "projects.create");
  const { workspace_id, name } = (input ?? {}) as { workspace_id?: unknown; name?: unknown };
  if (!workspace_id || !name || String(name).trim() === "") {
    throw badRequest("workspace_id and name are required");
  }
  const workspaceId = Number(workspace_id);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw badRequest("invalid workspace_id");
  const workspace = await db.query("SELECT id FROM workspaces WHERE id = $1::bigint", [workspaceId]);
  if (workspace.rowCount === 0) throw notFound("workspace not found");
  const projectId = await withTransaction(async (q) => {
    const p = await q.query(
      "INSERT INTO projects (workspace_id, name) VALUES ($1::bigint, $2) RETURNING id",
      [workspaceId, String(name).trim()],
    );
    const id = Number(p.rows[0].id);
    await q.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
      [id, actor.uid],
    );
    for (const [i, sname] of ["計画中", "進行中", "完了"].entries()) {
      await q.query("INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3)", [
        id,
        sname,
        (i + 1) * 1000,
      ]);
    }
    await ensureDefaultProjectTabs(id, q);
    return id;
  });
  await audit(actor.uid, "project.create", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: String(name).trim(),
  });
  return { id: projectId };
}

/**
 * Instantiate a project template for an actor that need not come from an HTTP
 * session. Tasks stay a direct INSERT so no task events or automations fire,
 * matching POST /api/project-templates/[id].
 */
export async function createProjectFromTemplate(
  actor: Actor,
  templateId: number,
  input: unknown,
): Promise<{ id: number }> {
  await requireWorkspacePermission(actor, "projects.create");
  const body = (input ?? {}) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw badRequest("name is required");
  const t = await db.query("SELECT workspace_id, payload FROM project_templates WHERE id = $1::bigint", [templateId]);
  if (t.rowCount === 0) throw notFound("not found");
  const workspaceId = Number(t.rows[0].workspace_id);
  const payload = t.rows[0].payload as ProjectTemplatePayload;

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
      [newId, actor.uid],
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

      const rules = Array.isArray(payload.rules) ? payload.rules.slice(0, 50) : [];
      for (const rule of rules) {
        if (!rule || typeof rule.name !== "string" || rule.name.trim() === "") continue;
        if (!rule.definition || typeof rule.definition !== "object") continue;
        const copy = copyRuleWithoutWebhookCredentials({ ...rule, definition: rule.definition });
        await q.query(
          `INSERT INTO project_rules (
             workspace_id, project_id, name, description, definition, owner_id, enabled
           ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint, $7)`,
          [
            workspaceId,
            newId,
            rule.name.trim().slice(0, 120),
            typeof rule.description === "string" ? rule.description.slice(0, 1000) : "",
            JSON.stringify(copy.definition),
            actor.uid,
            copy.enabled !== false,
          ],
        );
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
           assignee_id, start_on, due_on, progress, status, position, is_milestone)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
           $7::bigint, $8::date, $9::date, $10, $11, $12, $13)
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
          parentId === null && task.is_milestone === true,
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

  await audit(actor.uid, "project.template_use", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `template ${templateId}`,
  });
  await notifyProject(projectId);
  return { id: projectId };
}

/**
 * Update a project for an actor that need not come from an HTTP session.
 * Configuration access is resolved from live policy, and admin-only fields
 * keep the extra check that PATCH /api/projects/[id] performed.
 */
export async function updateProject(
  actor: Actor,
  projectId: number,
  patch: unknown,
): Promise<{ id: number; status_options_version?: number }> {
  const auth = await requireProjectAccess(actor, projectId, "configure");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw badRequest("invalid project patch");
  }
  const body = patch as Record<string, unknown>;
  if (auth.role !== "admin" && projectPatchRequiresAdmin(body)) {
    throw forbidden("project administration requires an admin");
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  let statusOptions: string[] | undefined;
  if (typeof body.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim().slice(0, 100));
    sets.push(`name = $${values.length}`);
  }
  if (typeof body.description === "string") {
    values.push(body.description.trim().slice(0, 5000));
    sets.push(`description = $${values.length}`);
  }
  if (typeof body.status === "string" && body.status.trim() !== "") {
    values.push(body.status.trim().slice(0, 100));
    sets.push(`status = $${values.length}`);
  }
  if (typeof body.status_color === "string") {
    const allowedColors = new Set(["none", "green", "yellow", "red", "blue", "muted"]);
    if (!allowedColors.has(body.status_color)) {
      throw badRequest("invalid status_color");
    }
    values.push(body.status_color);
    sets.push(`status_color = $${values.length}`);
  }
  if (Array.isArray(body.status_options)) {
    const opts = body.status_options
      .map((o: unknown) => String(o).trim())
      .filter((o: string) => o !== "")
      .slice(0, 20)
      .map((o: string) => o.slice(0, 40));
    if (opts.length === 0) {
      throw badRequest("status_options must be a non-empty array");
    }
    statusOptions = opts;
    values.push(JSON.stringify(opts));
    sets.push(`status_options = $${values.length}::jsonb`);
  }
  if (typeof body.status_field_name === "string" && body.status_field_name.trim() !== "") {
    values.push(body.status_field_name.trim().slice(0, 40));
    sets.push(`status_field_name = $${values.length}`);
  }
  if (typeof body.status_field_enabled === "boolean") {
    values.push(body.status_field_enabled);
    sets.push(`status_field_enabled = $${values.length}`);
  }
  const statusRenames: { from: string; to: string }[] = Array.isArray(body.status_renames)
    ? body.status_renames
        .filter(
          (entry: unknown): entry is { from: string; to: string } =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { from?: unknown }).from === "string" &&
            typeof (entry as { to?: unknown }).to === "string",
        )
        .map((entry: { from: string; to: string }) => ({
          from: entry.from.trim().slice(0, 40),
          to: entry.to.trim().slice(0, 40),
        }))
        .filter((entry: { from: string; to: string }) => entry.from !== "" && entry.to !== "" && entry.from !== entry.to)
        .slice(0, 20)
    : [];
  if (new Set(statusRenames.map(({ from }) => from)).size !== statusRenames.length) {
    throw badRequest("status_renames must have unique source names");
  }
  const expectedVersion: unknown = body.expected_status_options_version;
  if (expectedVersion !== undefined &&
      (!statusOptions || typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) ||
        expectedVersion < 0 || expectedVersion > 2_147_483_647)) {
    throw badRequest("invalid expected_status_options_version");
  }
  if (statusRenames.length && (!statusOptions || expectedVersion === undefined)) {
    throw badRequest("status_renames requires options and their expected version");
  }
  if (statusRenames.some(({ to }) => !statusOptions?.includes(to))) {
    throw badRequest("status_renames targets must be included in status_options");
  }
  if (statusOptions) sets.push("status_options_version = status_options_version + 1");
  if ("color" in body) {
    const color = body.color;
    if (color !== null && (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      throw badRequest("color must be a hex color or null");
    }
    values.push(color);
    sets.push(`color = $${values.length}`);
  }
  if ("icon" in body) {
    const icon = body.icon;
    const allowed = PROJECT_ICONS.map((i) => i.key).filter(Boolean) as string[];
    if (icon !== null && (typeof icon !== "string" || !allowed.includes(icon))) {
      throw badRequest("invalid icon");
    }
    values.push(icon);
    sets.push(`icon = $${values.length}`);
  }
  if (typeof body.archived === "boolean") {
    values.push(body.archived);
    sets.push(`archived_at = CASE WHEN $${values.length}::boolean THEN NOW() ELSE NULL END`);
  }
  if ("owner_id" in body) {
    const ownerId = body.owner_id === null || body.owner_id === "" ? null : Number(body.owner_id);
    if (ownerId !== null && (!Number.isInteger(ownerId) || ownerId <= 0)) {
      throw badRequest("invalid owner_id");
    }
    if (ownerId !== null) {
      const owner = await db.query("SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL", [ownerId]);
      if (owner.rowCount === 0) throw notFound("owner not found");
    }
    values.push(ownerId);
    sets.push(`owner_id = $${values.length}`);
  }
  if ("team_id" in body) {
    const teamId = body.team_id === null || body.team_id === "" ? null : Number(body.team_id);
    if (teamId !== null && (!Number.isInteger(teamId) || teamId <= 0)) {
      throw badRequest("invalid team_id");
    }
    if (teamId !== null) {
      const team = await db.query(
        `SELECT t.id FROM teams t
         WHERE t.id = $1::bigint
           AND t.workspace_id = (SELECT workspace_id FROM projects WHERE id = $2::bigint)`,
        [teamId, projectId],
      );
      if (team.rowCount === 0) throw notFound("team not found");
    }
    values.push(teamId);
    sets.push(`team_id = $${values.length}`);
  }
  if ("due_on" in body) {
    const due = body.due_on === null || body.due_on === "" ? null : String(body.due_on);
    if (due !== null) {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(due) ? Date.parse(`${due}T00:00:00Z`) : Number.NaN;
      if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== due) {
        throw badRequest("due_on must be a valid YYYY-MM-DD date or null");
      }
    }
    values.push(due);
    sets.push(`due_on = $${values.length}::date`);
  }
  if ("settings" in body) {
    if (body.settings !== null && (typeof body.settings !== "object" || Array.isArray(body.settings))) {
      throw badRequest("settings must be an object");
    }
    const current = await db.query("SELECT settings FROM projects WHERE id = $1::bigint", [projectId]);
    const merged = mergeProjectSettings(current.rows[0]?.settings, body.settings);
    if (merged.work_hours.start >= merged.work_hours.end) {
      throw badRequest("work_hours.start must be before work_hours.end");
    }
    values.push(JSON.stringify(merged));
    sets.push(`settings = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    throw badRequest(
      "name, description, status, status_color, status_options, status_field_name, status_field_enabled, color, icon, archived, owner_id, team_id, due_on or settings required",
    );
  }
  values.push(projectId);
  let where = `id = $${values.length}::bigint`;
  if (expectedVersion !== undefined) {
    values.push(expectedVersion);
    where += ` AND status_options_version = $${values.length}::int`;
  }
  const updated = await withTransaction(async (q) => {
    const project = await q.query<{ status_options_version: number }>(
      `UPDATE projects SET ${sets.join(", ")} WHERE ${where} RETURNING status_options_version`,
      values,
    );
    if (!project.rows[0]) return null;
    if (statusRenames.length > 0) {
      // One UPDATE maps the original values, so chains and swaps cannot
      // remap a task that was already renamed by this request.
      await q.query(
        `UPDATE tasks t SET status = rename.new_status, updated_at = now()
         FROM unnest($1::text[], $2::text[]) AS rename(old_status, new_status)
         WHERE t.project_id = $3::bigint AND t.deleted_at IS NULL AND t.status = rename.old_status`,
        [statusRenames.map(({ from }) => from), statusRenames.map(({ to }) => to), projectId],
      );
    }
    return project.rows[0];
  });
  if (!updated) {
    if (expectedVersion !== undefined) {
      const current = await db.query(
        `SELECT status_options, status_options_version, status_field_name, status_field_enabled
         FROM projects WHERE id = $1::bigint`,
        [projectId],
      );
      if (current.rows[0]) {
        throw new ProjectUpdateConflict(current.rows[0] as Record<string, unknown>);
      }
    }
    throw notFound("not found");
  }
  await audit(actor.uid, "project.update", {
    entity: "project",
    entityId: projectId,
    projectId,
  });
  await notifyProject(projectId);
  return statusOptions ? { id: projectId, ...updated } : { id: projectId };
}
