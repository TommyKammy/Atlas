/**
 * Session-independent read services for MCP reference tools.
 *
 * Every function starts from a live `Actor`, re-reads the user on each call, and
 * applies the same project/task authorization and visibility predicates as the
 * existing web surfaces. Results are plain JSON values: dates are already
 * returned as ISO text by the repositories and ids are normalized to numbers.
 */
import { badRequest, forbidden, notFound } from "../api/errors";
import { authorizeProject } from "../api-project-auth";
import { db } from "../db";
import { projectDataAccess } from "../data-actor";
import type { CommentRow, User } from "../data";
import type { CustomField } from "../custom-fields";
import type { TaskDetail } from "../repositories/task-projection";
import {
  getCustomFields,
  getProject,
  getProjectMembers,
  getSections,
  type Project,
  type Section,
} from "../repositories/projects";
import { getCommentsPage } from "../repositories/comments";
import { getTaskById, getTaskForProject } from "../repositories/tasks";
import {
  getTaskReadHomeProjectIds,
  searchTasksAdvanced,
  type AdvancedSearchFilters,
  type AdvancedTaskHit,
} from "../repositories/search";
import { directoryAccess } from "../repositories/users";
import type { SearchPage } from "../search-pagination";
import {
  loadAuthActor,
  requireProjectAccess,
  type Actor,
} from "./actor";
import { devSettingsFor, lookupTaskKey, taskKeysFor, type DevProjectSettings } from "./task-key-lookup";

export const DEFAULT_QUERY_LIMIT = 25;
export const MAX_QUERY_LIMIT = 100;
const MAX_CURSOR_OFFSET = 100_000;

export type QueryPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type QueryListOptions = {
  limit?: number;
  cursor?: string;
};

/** `dev` is the development-project setting, or null for ordinary projects. */
export type ProjectListItem = { id: number; name: string; dev: DevProjectSettings | null };

export type ProjectSummary = {
  project: {
    id: number;
    workspace_id: number | null;
    name: string;
    description: string | null;
    status: string;
    status_color: string | null;
    status_options: string[];
    status_field_name: string;
    status_field_enabled: boolean;
    color: string | null;
    icon: string | null;
    owner_id: number | null;
    team_id: number | null;
    due_on: string | null;
    dev: DevProjectSettings | null;
  };
  sections: Section[];
};

export type SearchTasksInput = QueryListOptions & {
  projectId?: number;
  assignee?: "me" | number;
  status?: string;
  /** Accepts the advanced-search vocabulary or a simple open/done boolean. */
  completed?: boolean | "all" | "open" | "done";
  dueBefore?: string;
  dueAfter?: string;
  query?: string;
};

export type TaskCustomFieldValue = {
  field_id: number;
  name: string;
  field_type: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
};

/**
 * A search hit with its issue key: the issuing project's current prefix and
 * number, wherever the task is now, or null when no key was issued.
 */
export type TaskHit = AdvancedTaskHit & { key: string | null };

export type TaskDetailView = {
  task: TaskDetail & { key: string | null };
  project: { id: number; name: string } | null;
  section: { id: number; name: string } | null;
  parent: { id: number; name: string } | null;
  customFieldValues: TaskCustomFieldValue[];
};

export type TaskParentRef = { id: number; name: string };

/**
 * A task returned by `list_my_tasks`. Subtasks are included, unlike the Atlas
 * "My tasks" view, and carry their parent name when the parent is viewable.
 */
export type MyTaskHit = TaskHit & {
  parent: TaskParentRef | null;
  /** True when the task has a parent the actor is not allowed to view. */
  parent_hidden: boolean;
};

export type ProjectMember = User & { role: string | null };

export type SelfIdentity = {
  id: number;
  name: string;
  email: string | null;
};

/** Clamp a caller limit to the MCP contract: default 25, at least 1, at most 100. */
export function queryLimit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_QUERY_LIMIT;
  const integer = Math.trunc(value);
  if (integer < 1) return 1;
  return Math.min(integer, MAX_QUERY_LIMIT);
}

/** Opaque offset cursor. Invalid or excessive cursors are rejected as bad input. */
function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  if (cursor.length > 512) throw badRequest("invalid cursor");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("invalid cursor");
    const offset = (parsed as { o?: unknown }).o;
    if (
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > MAX_CURSOR_OFFSET
    ) {
      throw new Error("invalid cursor");
    }
    return offset;
  } catch {
    throw badRequest("invalid cursor");
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
}

function pageResult<T>(rows: readonly T[], limit: number, offset: number): QueryPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return {
    items,
    nextCursor: hasMore ? encodeCursor(offset + items.length) : null,
  };
}

function searchPage<T>(result: SearchPage<T>, offset: number): QueryPage<T> {
  const items = result.items ?? [];
  return {
    items,
    nextCursor:
      offset + items.length < result.total ? encodeCursor(offset + items.length) : null,
  };
}

/** Fail closed before doing any domain read. */
async function requireActiveActor(actor: Actor): Promise<void> {
  if (!(await loadAuthActor(actor))) throw forbidden("unknown or inactive user");
}

export async function loadWorkspaceId(): Promise<number> {
  const result = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const id = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("workspace not found");
  return id;
}

/**
 * Archived projects stay available in the archive surface, but the MCP
 * reference tools treat them like deleted projects: they do not exist.
 */
async function loadVisibleProject(
  projectId: number,
): Promise<Project & { status_options_version?: number }> {
  const project = await getProject(projectId);
  if (!project || project.deleted_at != null || project.archived_at != null) {
    throw notFound("project not found");
  }
  return project;
}

function plainSection(row: Section): Section {
  return {
    id: Number(row.id),
    name: String(row.name),
    position: Number(row.position),
  };
}

function plainProject(
  project: Project & { status_options_version?: number },
  dev: DevProjectSettings | null,
): ProjectSummary["project"] {
  return {
    id: Number(project.id),
    workspace_id: project.workspace_id == null ? null : Number(project.workspace_id),
    name: String(project.name),
    description: project.description ?? null,
    status: String(project.status),
    status_color: project.status_color ?? null,
    status_options: Array.isArray(project.status_options)
      ? project.status_options.map(String)
      : [],
    status_field_name: String(project.status_field_name ?? ""),
    status_field_enabled: project.status_field_enabled === true,
    color: project.color ?? null,
    icon: project.icon ?? null,
    owner_id: project.owner_id == null ? null : Number(project.owner_id),
    team_id: project.team_id == null ? null : Number(project.team_id),
    due_on: project.due_on ?? null,
    dev,
  };
}

function plainUser(row: User): User {
  return {
    ...row,
    id: Number(row.id),
    is_guest: row.is_guest === true,
    is_admin: row.is_admin === true,
    role_id: row.role_id == null ? row.role_id : Number(row.role_id),
    deactivated_at: row.deactivated_at ?? null,
  };
}

function plainComment(row: CommentRow): CommentRow {
  return {
    ...row,
    id: Number(row.id),
    author_id: row.author_id == null ? null : Number(row.author_id),
  };
}

function plainField(row: CustomField): CustomField {
  return {
    ...row,
    id: Number(row.id),
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    description: row.description ?? "",
    access_level: row.access_level ?? "everyone",
    editor_ids: Array.isArray(row.editor_ids) ? row.editor_ids.map(Number) : [],
  };
}

function plainAdvancedHit(row: AdvancedTaskHit): AdvancedTaskHit {
  return {
    id: Number(row.id),
    name: String(row.name),
    completed: row.completed === true,
    progress: Number(row.progress),
    due_on: row.due_on ?? null,
    assignee_name: row.assignee_name ?? null,
    project_id: Number(row.project_id),
    project_name: String(row.project_name),
  };
}

function searchFilters(input: SearchTasksInput, actor: Actor): AdvancedSearchFilters {
  const completed =
    input.completed === undefined
      ? "all"
      : input.completed === true
        ? "done"
        : input.completed === false
          ? "open"
          : input.completed;
  return {
    q: input.query ?? "",
    projectId: input.projectId ?? null,
    assigneeId: input.assignee === "me" ? actor.uid : (input.assignee ?? null),
    completed,
    status: input.status ?? null,
    dueFrom: input.dueAfter ?? null,
    dueTo: input.dueBefore ?? null,
    createdFrom: null,
    createdTo: null,
    completedFrom: null,
    completedTo: null,
    custom: [],
  };
}

async function searchTaskPage(
  actor: Actor,
  input: SearchTasksInput,
): Promise<QueryPage<TaskHit>> {
  const workspaceId = await loadWorkspaceId();
  const keyTaskId = input.query === undefined ? null : await lookupTaskKey(input.query);
  const limit = queryLimit(input.limit);
  const offset = decodeCursor(input.cursor);
  const page = Math.floor(offset / limit) + 1;
  const result = await searchTasksAdvanced(
    workspaceId,
    { ...searchFilters(input, actor), keyTaskId },
    { userId: actor.uid },
    { page, pageSize: limit },
  );
  // The advanced search is page-based. If a caller changes `limit` between
  // cursor calls, trim the page back to the exact cursor offset instead of
  // returning earlier or later rows.
  const pageStart = (page - 1) * limit;
  const skip = offset - pageStart;
  const hits = result.items.slice(skip, skip + limit).map(plainAdvancedHit);
  const keys = await taskKeysFor(hits.map((hit) => hit.id));
  const items = hits.map((hit) => ({ ...hit, key: keys.get(hit.id) ?? null }));
  return searchPage({ ...result, items }, offset);
}

/**
 * Identity of the live actor, used by `whoami`. Deactivated and unknown users
 * fail closed like every other MCP reference call.
 */
export async function getSelf(actor: Actor): Promise<SelfIdentity> {
  await requireActiveActor(actor);
  const result = await db.query(
    `SELECT id, name, email FROM users WHERE id = $1::bigint AND deactivated_at IS NULL`,
    [actor.uid],
  );
  const row = result.rows[0];
  if (!row) throw notFound("user not found");
  return {
    id: Number(row.id),
    name: String(row.name),
    email: row.email == null ? null : String(row.email),
  };
}

/** Projects visible to the actor: workspace admins or project members. */
export async function listProjects(
  actor: Actor,
  options: QueryListOptions & { query?: string } = {},
): Promise<QueryPage<ProjectListItem>> {
  await requireActiveActor(actor);
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const query = (options.query ?? "").trim();
  const params: unknown[] = [actor.uid];
  let nameFilter = "";
  if (query !== "") {
    params.push(likePattern(query));
    nameFilter = ` AND p.name ILIKE $${params.length}`;
  }
  params.push(limit + 1, offset);
  const result = await db.query(
    `SELECT p.id, p.name
     FROM projects p
     WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
       AND ${projectDataAccess("p", "$1")}${nameFilter}
     ORDER BY p.name, p.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const dev = await devSettingsFor(result.rows.slice(0, limit).map((row) => Number(row.id)));
  return pageResult(
    result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      dev: dev.get(Number(row.id)) ?? null,
    })),
    limit,
    offset,
  );
}

/** Basic project information plus the full section list. */
export async function getProjectSummary(
  actor: Actor,
  projectId: number,
): Promise<ProjectSummary> {
  await requireActiveActor(actor);
  await requireProjectAccess(actor, projectId, "view");
  const project = await loadVisibleProject(projectId);
  const [sections, dev] = await Promise.all([getSections(projectId), devSettingsFor([projectId])]);
  return {
    project: plainProject(project, dev.get(projectId) ?? null),
    sections: sections.map(plainSection),
  };
}

export async function listSections(
  actor: Actor,
  projectId: number,
  options: QueryListOptions = {},
): Promise<QueryPage<Section>> {
  await requireActiveActor(actor);
  await requireProjectAccess(actor, projectId, "view");
  await loadVisibleProject(projectId);
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const sections = await getSections(projectId);
  return pageResult(sections.map(plainSection).slice(offset), limit, offset);
}

/** Authorized task search. Project-scoped searches re-check project access first. */
export async function searchTasks(
  actor: Actor,
  input: SearchTasksInput = {},
): Promise<QueryPage<TaskHit>> {
  await requireActiveActor(actor);
  if (input.projectId !== undefined) {
    await requireProjectAccess(actor, input.projectId, "view");
    await loadVisibleProject(input.projectId);
  }
  return searchTaskPage(actor, input);
}

/**
 * Open tasks assigned to the actor, narrowed by the same `projectDataAccess`
 * predicate as the advanced search. `getMyTasks` intentionally is not used
 * because it does not filter by project permission.
 *
 * Unlike the Atlas "My tasks" view, subtasks are included. Parent names are
 * resolved for the whole page in one query; a parent the actor cannot read is
 * reported only through `parent_hidden` so its name never leaks.
 */
export async function listMyTasks(
  actor: Actor,
  options: QueryListOptions = {},
): Promise<QueryPage<MyTaskHit>> {
  await requireActiveActor(actor);
  const page = await searchTaskPage(actor, {
    assignee: actor.uid,
    completed: "open",
    limit: options.limit,
    cursor: options.cursor,
  });
  const parents = await loadTaskParents(actor, page.items.map((item) => item.id));
  return {
    ...page,
    items: page.items.map((item) => {
      const parent = parents.get(item.id);
      return {
        ...item,
        parent: parent?.parent ?? null,
        parent_hidden: parent?.hidden === true,
      };
    }),
  };
}

/**
 * Fail unless `getTaskDetail` and `listComments` would read the task: the same
 * live actor, homes and errors. Key resolution uses this for view access so
 * a key reads exactly the tasks its numeric id does.
 */
export async function requireTaskReadable(actor: Actor, taskId: number): Promise<void> {
  await requireActiveActor(actor);
  await loadAuthorizedTask(actor, taskId);
}

/**
 * Resolve a task through the first home that grants view access and is still
 * visible. Homes follow `TASK_SEARCH_HOMES`: own primary, own memberships, then
 * a compatible immediate parent's primary and memberships. The default project
 * comes first, but an archived primary must not hide an active secondary home.
 * Workspace admins can also read projectless tasks, matching `authorizeTask`.
 */
async function loadAuthorizedTask(
  actor: Actor,
  taskId: number,
): Promise<{ task: TaskDetail; project: Project | null }> {
  const authActor = await loadAuthActor(actor);
  if (!authActor) throw forbidden("unknown or inactive user");
  const projectIds = await getTaskReadHomeProjectIds(taskId);
  if (projectIds === null) throw notFound("task not found");
  if (projectIds.length === 0) {
    if (!authActor.isAdmin) throw notFound("task not found");
    const task = await getTaskById(taskId);
    if (!task) throw notFound("task not found");
    return { task, project: null };
  }

  let lastError: { status: 403 | 404; error: string } = {
    status: 403,
    error: "project access denied",
  };
  let authorized = false;
  let taskMissing = false;
  for (const projectId of projectIds) {
    const auth = await authorizeProject(authActor, projectId, "view");
    if (!auth.ok) {
      lastError = auth;
      continue;
    }
    authorized = true;
    const project = await getProject(projectId);
    if (!project || project.deleted_at != null || project.archived_at != null) continue;
    const task = await getTaskForProject(taskId, projectId);
    if (!task) {
      taskMissing = true;
      continue;
    }
    return { task, project };
  }
  if (taskMissing) throw notFound("task not found");
  if (authorized) throw notFound("project not found");
  throw lastError.status === 404 ? notFound(lastError.error) : forbidden(lastError.error);
}

/**
 * Parent visibility shared by `get_task` and the batched `list_my_tasks`
 * lookup. A parent is viewable through its primary project or one of its
 * multi-home memberships, and only when that project is neither archived nor
 * deleted.
 */
function parentVisibilitySql(parentAlias: string, actorParam: string): string {
  return `EXISTS (SELECT 1 FROM projects p
           WHERE p.id = ${parentAlias}.project_id AND p.archived_at IS NULL AND p.deleted_at IS NULL
             AND ${projectDataAccess("p", actorParam)})
         OR EXISTS (SELECT 1 FROM task_project_memberships m
           JOIN projects p ON p.id = m.project_id
           WHERE m.task_id = ${parentAlias}.id AND p.archived_at IS NULL AND p.deleted_at IS NULL
             AND ${projectDataAccess("p", actorParam)})`;
}

async function loadParent(
  actor: Actor,
  parentTaskId: number | null,
): Promise<TaskParentRef | null> {
  if (parentTaskId === null) return null;
  const result = await db.query(
    `SELECT pt.id, pt.name
     FROM tasks pt
     WHERE pt.id = $1 AND pt.deleted_at IS NULL
       AND (
         ${parentVisibilitySql("pt", "$2")}
       )`,
    [parentTaskId, actor.uid],
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), name: String(row.name) } : null;
}

type ParentLookup = {
  parent: TaskParentRef | null;
  hidden: boolean;
};

/**
 * Resolve parent names for one page of tasks in a single query. Deleted and
 * inaccessible parents are kept as `hidden` without exposing their name.
 */
async function loadTaskParents(
  actor: Actor,
  taskIds: readonly number[],
): Promise<Map<number, ParentLookup>> {
  const parents = new Map<number, ParentLookup>();
  if (taskIds.length === 0) return parents;
  const result = await db.query(
    `SELECT t.id AS task_id, pt.id AS parent_id, pt.name AS parent_name,
       (pt.id IS NOT NULL AND pt.deleted_at IS NULL
         AND (${parentVisibilitySql("pt", "$2")})) AS parent_visible
     FROM tasks t
     LEFT JOIN tasks pt ON pt.id = t.parent_task_id
     WHERE t.id = ANY($1::bigint[])`,
    [taskIds, actor.uid],
  );
  for (const row of result.rows) {
    const taskId = Number(row.task_id);
    if (row.parent_id == null) {
      parents.set(taskId, { parent: null, hidden: false });
    } else if (row.parent_visible === true) {
      parents.set(taskId, {
        parent: { id: Number(row.parent_id), name: String(row.parent_name) },
        hidden: false,
      });
    } else {
      parents.set(taskId, { parent: null, hidden: true });
    }
  }
  return parents;
}

async function loadTaskSection(
  sectionId: number | null,
  projectId: number | null,
): Promise<{ id: number; name: string } | null> {
  if (sectionId === null) return null;
  const result = projectId === null
    ? await db.query("SELECT id, name FROM sections WHERE id = $1", [sectionId])
    : await db.query(
        "SELECT id, name FROM sections WHERE id = $1 AND project_id = $2",
        [sectionId, projectId],
      );
  const row = result.rows[0];
  return row ? { id: Number(row.id), name: String(row.name) } : null;
}

async function loadTaskCustomFieldValues(
  actor: Actor,
  taskId: number,
): Promise<TaskCustomFieldValue[]> {
  const result = await db.query(
    `SELECT v.field_id, f.name, f.field_type, v.value_text, v.value_number,
       v.value_date::text AS value_date, v.value_json
     FROM task_custom_values v
     JOIN custom_fields f ON f.id = v.field_id AND f.deleted_at IS NULL
     JOIN projects fp ON fp.id = f.project_id
     WHERE v.task_id = $1
       AND fp.archived_at IS NULL AND fp.deleted_at IS NULL
       AND ${projectDataAccess("fp", "$2")}
     ORDER BY f.position, f.id`,
    [taskId, actor.uid],
  );
  return result.rows.map((row) => ({
    field_id: Number(row.field_id),
    name: String(row.name),
    field_type: String(row.field_type),
    value_text: row.value_text ?? null,
    value_number: row.value_number == null ? null : Number(row.value_number),
    value_date: row.value_date ?? null,
    value_json: row.value_json ?? null,
  }));
}

/**
 * Full task detail available from the existing read models, including the
 * effective section, the authorized project, and custom field values from
 * projects the actor can still view.
 */
export async function getTaskDetail(actor: Actor, taskId: number): Promise<TaskDetailView> {
  await requireActiveActor(actor);
  const { task, project } = await loadAuthorizedTask(actor, taskId);
  // With access granted through a secondary home, only that home's effective
  // section is allowed. The primary project's section must not leak, and a
  // missing secondary section stays null instead of falling back to it.
  const sourceSectionId = project ? task.eff_section_id : task.section_id;
  const [section, parent, customFieldValues, keys] = await Promise.all([
    loadTaskSection(
      sourceSectionId == null ? null : Number(sourceSectionId),
      project ? Number(project.id) : null,
    ),
    loadParent(actor, task.parent_task_id),
    loadTaskCustomFieldValues(actor, taskId),
    taskKeysFor([taskId]),
  ]);
  const sectionId = project
    ? section
      ? section.id
      : null
    : task.section_id == null
      ? null
      : Number(task.section_id);
  return {
    task: {
      ...task,
      // Access may have been granted through a multi-home project rather than
      // the primary one. Keep project/section/parent references inside the
      // authorized surface so inaccessible ids are not leaked.
      project_id: project ? Number(project.id) : null,
      project_name: project ? project.name : null,
      section_id: sectionId,
      eff_section_id: sectionId,
      parent_task_id: parent ? parent.id : null,
      key: keys.get(taskId) ?? null,
    },
    project: project ? { id: Number(project.id), name: project.name } : null,
    section,
    parent,
    customFieldValues,
  };
}

/** Comments for a task the actor can view, fetched with DB-side pagination. */
export async function listComments(
  actor: Actor,
  taskId: number,
  options: QueryListOptions = {},
): Promise<QueryPage<CommentRow>> {
  await requireActiveActor(actor);
  await loadAuthorizedTask(actor, taskId);
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const comments = await getCommentsPage(taskId, limit + 1, offset);
  return pageResult(comments.map(plainComment), limit, offset);
}

/** Directory visibility matches `getDirectoryUsers` (guests see collaborators only). */
export async function listUsers(
  actor: Actor,
  options: QueryListOptions & { query?: string } = {},
): Promise<QueryPage<User>> {
  await requireActiveActor(actor);
  const workspaceId = await loadWorkspaceId();
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const query = (options.query ?? "").trim();
  const params: unknown[] = [workspaceId, actor.uid];
  let nameFilter = "";
  if (query !== "") {
    params.push(likePattern(query));
    nameFilter = ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }
  params.push(limit + 1, offset);
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin
     FROM users u
     WHERE u.deactivated_at IS NULL AND ${directoryAccess("u", "$2", "$1")}${nameFilter}
     ORDER BY u.name, u.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return pageResult(result.rows.map(plainUser), limit, offset);
}

export async function listProjectMembers(
  actor: Actor,
  projectId: number,
  options: QueryListOptions = {},
): Promise<QueryPage<ProjectMember>> {
  await requireActiveActor(actor);
  await requireProjectAccess(actor, projectId, "view");
  await loadVisibleProject(projectId);
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const members = await getProjectMembers(projectId);
  return pageResult(
    members
      .map((member) => ({ ...plainUser(member), role: member.role ?? null }))
      .slice(offset),
    limit,
    offset,
  );
}

export async function listCustomFields(
  actor: Actor,
  projectId: number,
  options: QueryListOptions = {},
): Promise<QueryPage<CustomField>> {
  await requireActiveActor(actor);
  await requireProjectAccess(actor, projectId, "view");
  await loadVisibleProject(projectId);
  const limit = queryLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const fields = await getCustomFields(projectId);
  return pageResult(fields.map(plainField).slice(offset), limit, offset);
}
