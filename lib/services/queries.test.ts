import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import type { Actor } from "./actor";
import {
  getProjectSummary,
  getTaskDetail,
  listComments,
  listCustomFields,
  listMyTasks,
  listProjectMembers,
  listProjects,
  listSections,
  listUsers,
  searchTasks,
} from "./queries";

type Call = { sql: string; params?: unknown[] };

type MockOptions = {
  active?: boolean;
  isAdmin?: boolean;
  /** Effective project role. `null` means no project access. */
  role?: string | null;
  /** `undefined` uses the default task, `null` means the task does not exist. */
  taskContext?: { default_project_id: number | null; project_ids: number[] } | null;
  /** `undefined` uses the default project, `null` means the project does not exist. */
  project?: Record<string, unknown> | null;
  projects?: Record<string, unknown>[];
  sections?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  fields?: Record<string, unknown>[];
  task?: Record<string, unknown> | null;
  comments?: Record<string, unknown>[];
  values?: Record<string, unknown>[];
  parent?: Record<string, unknown> | null;
  sectionName?: Record<string, unknown> | null;
  searchItems?: Record<string, unknown>[];
  searchTotal?: number;
  searchPage?: number;
  searchPageCount?: number;
};

const actor: Actor = { uid: 12, source: "mcp" };

const DEFAULT_TASK_CONTEXT = { default_project_id: 7, project_ids: [7] };

const defaultProject = {
  id: 7,
  workspace_id: 1,
  name: "Alpha",
  description: "Project alpha",
  status: "active",
  status_color: null,
  status_options: ["todo", "done"],
  status_options_version: 1,
  status_field_name: "Status",
  status_field_enabled: true,
  color: null,
  icon: null,
  email_address: null,
  email_enabled: false,
  owner_id: null,
  team_id: null,
  due_on: null,
  settings: {},
  archived_at: null,
  deleted_at: null,
};

const defaultTask = {
  id: 42,
  project_id: 7,
  section_id: 3,
  parent_task_id: null,
  name: "Write tests",
  description: "Cover the read services",
  description_doc: null,
  assignee_id: 12,
  assignee_name: "Actor",
  created_by: 1,
  creator_name: "Owner",
  completed: false,
  completed_at: null,
  start_on: null,
  due_on: "2026-12-01",
  progress: 0,
  status: "todo",
  is_milestone: false,
  position: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  recurrence: "",
  project_name: "Alpha",
  approval: null,
  like_count: 0,
  comment_count: 0,
  subtask_count: 0,
  attachment_count: 0,
  blocked_by_count: 0,
  blocking_count: 0,
  collaborators: [],
  eff_section_id: 3,
};

const searchHit = {
  id: 42,
  name: "Write tests",
  completed: false,
  progress: 0,
  due_on: "2026-12-01",
  assignee_name: "Actor",
  project_id: 7,
  project_name: "Alpha",
};

/** Minimal Queryable covering actor, authorization and reference-service SQL. */
function mockQueries(options: MockOptions, calls: Call[] = []) {
  return async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("SELECT u.is_admin, u.is_guest, u.deactivated_at")) {
      rows = options.active === false
        ? []
        : [{ is_admin: options.isAdmin ?? false, is_guest: false, deactivated_at: null }];
    } else if (sql.includes("LEFT JOIN project_members")) {
      rows = [{ is_admin: options.isAdmin ?? false, deactivated_at: null, role: options.role ?? null }];
    } else if (sql.includes("AS default_project_id")) {
      const context = options.taskContext === undefined ? DEFAULT_TASK_CONTEXT : options.taskContext;
      rows = context ? [{ ...context }] : [];
    } else if (sql.includes("FROM workspaces")) {
      rows = [{ id: 1 }];
    } else if (sql.includes("FROM projects p") && sql.includes("ORDER BY p.name, p.id")) {
      rows = options.projects ?? [];
    } else if (sql.includes("SELECT id, workspace_id, name, description")) {
      rows = options.project === null ? [] : [options.project ?? defaultProject];
    } else if (sql.includes("FROM sections WHERE project_id")) {
      rows = options.sections ?? [];
    } else if (sql.includes("FROM project_members m JOIN users u")) {
      rows = options.members ?? [];
    } else if (sql.includes("FROM custom_fields WHERE project_id")) {
      rows = options.fields ?? [];
    } else if (sql.includes("task_home")) {
      rows = [{
        total: String(options.searchTotal ?? options.searchItems?.length ?? 0),
        page: String(options.searchPage ?? 1),
        page_count: String(options.searchPageCount ?? 1),
        items: options.searchItems ?? [],
      }];
    } else if (sql.includes("FROM tasks t") && sql.includes("task_timeline_rows")) {
      rows = options.task === null ? [] : [options.task ?? defaultTask];
    } else if (sql.includes("FROM tasks t") && sql.includes("WHERE t.id = $1 AND t.deleted_at IS NULL")) {
      rows = options.task === null ? [] : [options.task ?? defaultTask];
    } else if (sql.includes("SELECT pt.id, pt.name")) {
      rows = options.parent ? [options.parent] : [];
    } else if (sql.includes("SELECT id, name FROM sections WHERE id = $1")) {
      rows = options.sectionName ? [options.sectionName] : [];
    } else if (sql.includes("FROM task_custom_values v")) {
      rows = options.values ?? [];
    } else if (sql.includes("FROM comments c")) {
      rows = options.comments ?? [];
    } else if (sql.includes("FROM users u") && sql.includes("NOT viewer.is_guest")) {
      rows = options.users ?? [];
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  };
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  message: string,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.equal(error.code, code);
    return true;
  });
}

function lastCall(calls: Call[], marker: string): Call {
  const call = [...calls].reverse().find((entry) => entry.sql.includes(marker));
  assert.ok(call, `missing SQL containing ${marker}`);
  return call;
}

test("every query service rejects an unknown or inactive actor", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({ active: false }, calls));

  const callsToServices = [
    () => listProjects(actor),
    () => getProjectSummary(actor, 7),
    () => listSections(actor, 7),
    () => searchTasks(actor, { projectId: 7 }),
    () => getTaskDetail(actor, 42),
    () => listComments(actor, 42),
    () => listMyTasks(actor),
    () => listUsers(actor),
    () => listProjectMembers(actor, 7),
    () => listCustomFields(actor, 7),
  ];

  for (const call of callsToServices) {
    await assertApiError(call(), 403, "unknown or inactive user", "forbidden");
  }
  assert.equal(calls.length, callsToServices.length);
});

test("project-scoped queries use requireProjectAccess and fail closed", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({ role: null }, calls));

  await assertApiError(getProjectSummary(actor, 7), 403, "project access denied", "forbidden");
  await assertApiError(listSections(actor, 7), 403, "project access denied", "forbidden");
  await assertApiError(searchTasks(actor, { projectId: 7 }), 403, "project access denied", "forbidden");
  await assertApiError(listProjectMembers(actor, 7), 403, "project access denied", "forbidden");
  await assertApiError(listCustomFields(actor, 7), 403, "project access denied", "forbidden");

  assert.ok(!calls.some((call) => call.sql.includes("FROM sections WHERE project_id")));
  assert.ok(!calls.some((call) => call.sql.includes("FROM custom_fields WHERE project_id")));
});

test("task-scoped queries use requireTaskAccess and fail closed", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({ role: null }, calls));

  await assertApiError(getTaskDetail(actor, 42), 403, "project access denied", "forbidden");
  await assertApiError(listComments(actor, 42), 403, "project access denied", "forbidden");
  assert.ok(!calls.some((call) => call.sql.includes("task_home")));
});

test("a missing task stays hidden as 404", async (t) => {
  t.mock.method(db, "query", mockQueries({ taskContext: null }));
  await assertApiError(getTaskDetail(actor, 999), 404, "task not found", "not_found");
  await assertApiError(listComments(actor, 999), 404, "task not found", "not_found");
});

test("archived and deleted projects are hidden from summaries and project searches", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "viewer",
    project: { ...defaultProject, archived_at: "2026-01-03T00:00:00Z" },
  }, calls));

  await assertApiError(getProjectSummary(actor, 7), 404, "project not found", "not_found");
  calls.length = 0;
  await assertApiError(searchTasks(actor, { projectId: 7 }), 404, "project not found", "not_found");
});

test("listMyTasks filters through the authorized advanced search", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({ searchItems: [searchHit], searchTotal: 1 }, calls));

  const page = await listMyTasks(actor);
  assert.deepEqual(page.items, [searchHit]);
  assert.equal(page.nextCursor, null);

  const search = lastCall(calls, "task_home");
  assert.ok(search.sql.includes("data_actor.is_admin"));
  assert.ok(search.sql.includes("project_members data_member"));
  assert.ok(search.sql.includes("p.archived_at IS NULL"));
  assert.ok(search.sql.includes("p.deleted_at IS NULL"));
  assert.ok(search.sql.includes("t.deleted_at IS NULL"));
  assert.ok(search.sql.includes("t.assignee_id = $"));
  assert.deepEqual(search.params?.slice(0, 2), [1, actor.uid]);
});

test("listProjects clamps limits and emits an opaque cursor", async (t) => {
  const calls: Call[] = [];
  const projects = [
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" },
    { id: 3, name: "Gamma" },
  ];
  t.mock.method(db, "query", mockQueries({ projects }, calls));

  const first = await listProjects(actor, { limit: 0 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const firstQuery = lastCall(calls, "ORDER BY p.name, p.id");
  assert.deepEqual(firstQuery.params?.slice(-2), [2, 0]);

  calls.length = 0;
  const second = await listProjects(actor, { limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  const secondQuery = lastCall(calls, "ORDER BY p.name, p.id");
  assert.deepEqual(secondQuery.params?.slice(-2), [2, 1]);

  calls.length = 0;
  const capped = await listProjects(actor, { limit: 1000 });
  assert.equal(capped.items.length, 3);
  assert.equal(capped.nextCursor, null);
  const cappedQuery = lastCall(calls, "ORDER BY p.name, p.id");
  assert.deepEqual(cappedQuery.params?.slice(-2), [101, 0]);
});

test("searchTasks paginates through the advanced search with the same limits", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    searchItems: [searchHit],
    searchTotal: 3,
    searchPage: 1,
    searchPageCount: 3,
  }, calls));

  const first = await searchTasks(actor, { limit: 1, completed: false });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const firstSearch = lastCall(calls, "task_home");
  assert.deepEqual(firstSearch.params?.slice(-2), [1, 1]);
  assert.ok(firstSearch.sql.includes("t.completed = FALSE"));

  calls.length = 0;
  const second = await searchTasks(actor, { limit: 1, cursor: first.nextCursor });
  assert.ok(second.items.length === 1);
  const secondSearch = lastCall(calls, "task_home");
  assert.deepEqual(secondSearch.params?.slice(-2), [1, 2]);
});

test("listComments clamps its limit and pages in SQL", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "viewer",
    comments: [
      { id: 1, author_id: 12, author_name: "Actor", body: "one", created_at: "2026-01-01", edited_at: null },
      { id: 2, author_id: 12, author_name: "Actor", body: "two", created_at: "2026-01-02", edited_at: null },
    ],
  }, calls));

  const page = await listComments(actor, 42, { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 1);
  assert.ok(page.nextCursor);
  const comments = lastCall(calls, "FROM comments c");
  assert.deepEqual(comments.params?.slice(-2), [2, 0]);
});

test("getTaskDetail returns normalized task, section, parent and authorized values", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "viewer",
    task: { ...defaultTask, parent_task_id: 40 },
    sectionName: { id: 3, name: "To do" },
    parent: { id: 40, name: "Parent task" },
    values: [{
      field_id: 9,
      name: "Points",
      field_type: "number",
      value_text: null,
      value_number: "5",
      value_date: null,
      value_json: null,
    }],
  }, calls));

  const detail = await getTaskDetail(actor, 42);
  assert.equal(detail.task.id, 42);
  assert.equal(detail.task.project_name, "Alpha");
  assert.equal(detail.project?.id, 7);
  assert.equal(detail.section?.name, "To do");
  assert.equal(detail.parent?.name, "Parent task");
  assert.equal(detail.customFieldValues[0].field_id, 9);
  assert.equal(detail.customFieldValues[0].value_number, 5);

  const values = lastCall(calls, "FROM task_custom_values v");
  assert.ok(values.sql.includes("data_actor.is_admin"));
  assert.ok(values.sql.includes("fp.archived_at IS NULL"));
  assert.ok(values.sql.includes("fp.deleted_at IS NULL"));
});

test("project-scoped lists return paginated repository data", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    role: "viewer",
    sections: [
      { id: 3, name: "To do", position: 0 },
      { id: 4, name: "Done", position: 1 },
    ],
    members: [
      { id: 1, name: "Alice", is_guest: false, role: "admin" },
      { id: 2, name: "Bob", is_guest: false, role: "viewer" },
    ],
    fields: [{
      id: 9,
      name: "Points",
      field_type: "number",
      options: [],
      description: "",
      config: {},
      access_level: "everyone",
      editor_ids: [],
    }],
  }, calls));

  const summary = await getProjectSummary(actor, 7);
  assert.equal(summary.project.name, "Alpha");
  assert.equal(summary.project.workspace_id, 1);
  assert.equal(summary.sections.length, 2);

  const sections = await listSections(actor, 7, { limit: 1 });
  assert.equal(sections.items.length, 1);
  assert.ok(sections.nextCursor);

  const members = await listProjectMembers(actor, 7, { limit: 1 });
  assert.equal(members.items.length, 1);
  assert.equal(members.items[0].role, "admin");
  assert.ok(members.nextCursor);

  const fields = await listCustomFields(actor, 7, { limit: 1 });
  assert.equal(fields.items.length, 1);
  assert.equal(fields.items[0].id, 9);
  assert.equal(fields.nextCursor, null);
});

test("list queries default to 25 and reject malformed cursors", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({ projects: [] }, calls));

  const page = await listProjects(actor);
  assert.deepEqual(page, { items: [], nextCursor: null });
  const query = lastCall(calls, "ORDER BY p.name, p.id");
  assert.equal(query.params?.at(-2), 26);

  await assertApiError(
    listProjects(actor, { cursor: "!!!" }),
    400,
    "invalid cursor",
    "bad_request",
  );
});

test("listUsers keeps directory visibility and clamps the limit", async (t) => {
  const calls: Call[] = [];
  t.mock.method(db, "query", mockQueries({
    users: [
      { id: 1, name: "Alice", email: "alice@example.com", is_guest: false, is_admin: true },
      { id: 2, name: "Bob", email: "bob@example.com", is_guest: false, is_admin: false },
    ],
  }, calls));

  const page = await listUsers(actor, { limit: 0, query: "ali" });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 1);
  assert.ok(page.nextCursor);

  const query = lastCall(calls, "NOT viewer.is_guest");
  assert.ok(query.sql.includes("u.deactivated_at IS NULL"));
  assert.deepEqual(query.params?.slice(-2), [2, 0]);
});
