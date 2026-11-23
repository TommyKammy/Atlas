import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "./db";
import {
  actorFromSession,
  authorizeProject,
  authorizeTask,
  authorizeWorkspaceAdmin,
  orderTaskProjectIds,
  requireActiveUser,
  requireProjectPermission,
  requireTaskPermission,
  requireWorkspaceAdmin,
  type AuthActor,
} from "./api-project-auth";

test("orderTaskProjectIds keeps the default project first", () => {
  assert.deepEqual(
    orderTaskProjectIds({ defaultProjectId: 7, projectIds: [3, 7, 9] }),
    [7, 3, 9],
  );
});

test("orderTaskProjectIds does not duplicate the default project", () => {
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: 3, projectIds: [3] }), [3]);
});

test("orderTaskProjectIds handles tasks without a default project", () => {
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: null, projectIds: [4, 5] }), [4, 5]);
  assert.deepEqual(orderTaskProjectIds({ defaultProjectId: null, projectIds: [] }), []);
});

type ProjectAccessRow = {
  is_admin?: boolean;
  deactivated_at?: string | null;
  role?: string | null;
};

function authQueryable(options: {
  context?: { default_project_id: number | null; project_ids: Array<number | string> | null } | null;
  access?: (uid: number, projectId: number) => ProjectAccessRow | undefined;
  settings?: Record<string, unknown>;
} = {}): Queryable {
  return {
    query: async (sql, params) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("AS default_project_id")) {
        rows = options.context ? [{ ...options.context }] : [];
      } else if (sql.includes("SELECT settings FROM projects")) {
        rows = [{ settings: options.settings ?? {} }];
      } else if (sql.includes("FROM users u")) {
        const access = options.access?.(Number(params?.[0]), Number(params?.[1]));
        rows = access ? [{ is_admin: false, deactivated_at: null, role: null, ...access }] : [];
      } else {
        throw new Error(`unexpected query: ${sql}`);
      }
      return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
    },
  };
}

const viewer: AuthActor = { uid: 11, isAdmin: false, isGuest: false };
const editor: AuthActor = { uid: 12, isAdmin: false, isGuest: false };
const admin: AuthActor = { uid: 13, isAdmin: true, isGuest: false };

test("authorizeProject evaluates the requested level for an actor", async () => {
  const access = (uid: number) =>
    uid === viewer.uid
      ? { role: "viewer" }
      : uid === editor.uid
        ? { role: "editor" }
        : uid === admin.uid
          ? { is_admin: true, role: null }
          : undefined;
  assert.deepEqual(
    await authorizeProject(viewer, 7, "view", authQueryable({ access })),
    { ok: true, uid: 11, role: "viewer", workspaceAdmin: false },
  );
  assert.deepEqual(
    await authorizeProject(editor, 7, "edit", authQueryable({ access })),
    { ok: true, uid: 12, role: "editor", workspaceAdmin: false },
  );
  assert.deepEqual(
    await authorizeProject(viewer, 7, "comment", authQueryable({ access })),
    { ok: false, status: 403, error: "insufficient project role" },
  );
  assert.deepEqual(
    await authorizeProject({ uid: 99, isAdmin: false, isGuest: false }, 7, "view", authQueryable({ access })),
    { ok: false, status: 403, error: "project access denied" },
  );
});

test("authorizeProject keeps configure and share policy checks", async () => {
  const editorQuery = (settings: Record<string, unknown>) =>
    authQueryable({ access: () => ({ role: "editor" }), settings });
  assert.deepEqual(
    await authorizeProject(editor, 7, "configure", editorQuery({ who_can_edit: "editors" })),
    { ok: true, uid: 12, role: "editor", workspaceAdmin: false },
  );
  assert.deepEqual(
    await authorizeProject(editor, 7, "configure", editorQuery({ who_can_edit: "admins" })),
    { ok: false, status: 403, error: "insufficient project role" },
  );
  assert.deepEqual(
    await authorizeProject(editor, 7, "share", editorQuery({ who_can_share: "editors" })),
    { ok: true, uid: 12, role: "editor", workspaceAdmin: false },
  );
  assert.deepEqual(
    await authorizeProject(editor, 7, "share", editorQuery({})),
    { ok: false, status: 403, error: "insufficient project role" },
  );
  const adminQuery = authQueryable({
    access: () => ({ is_admin: true }),
    settings: { who_can_edit: "admins", who_can_share: "admins" },
  });
  assert.deepEqual(
    await authorizeProject(admin, 7, "configure", adminQuery),
    { ok: true, uid: 13, role: "admin", workspaceAdmin: true },
  );
});

test("authorizeProject fails closed for a deactivated workspace admin", async () => {
  const q = authQueryable({ access: () => ({ is_admin: true, deactivated_at: "2026-01-01" }) });
  assert.deepEqual(
    await authorizeProject(admin, 7, "view", q),
    { ok: false, status: 403, error: "project access denied" },
  );
});

test("authorizeWorkspaceAdmin is a pure actor check", () => {
  assert.deepEqual(authorizeWorkspaceAdmin(admin), { ok: true, uid: 13 });
  assert.deepEqual(
    authorizeWorkspaceAdmin(editor),
    { ok: false, status: 403, error: "workspace admin required" },
  );
  assert.deepEqual(
    authorizeWorkspaceAdmin({ uid: 14, isAdmin: true, isGuest: true }),
    { ok: true, uid: 14 },
  );
});

test("actorFromSession maps the session identity", () => {
  assert.deepEqual(
    actorFromSession({ id: 21, name: "Actor", email: "actor@example.test", isAdmin: true, isGuest: false }),
    { uid: 21, isAdmin: true, isGuest: false },
  );
});

test("authorizeTask accepts any project the task belongs to", async () => {
  const lookedUp: number[] = [];
  const q = authQueryable({
    context: { default_project_id: 7, project_ids: [7, "9"] },
    access: (uid, projectId) => {
      lookedUp.push(projectId);
      return uid === editor.uid && projectId === 9 ? { role: "editor" } : undefined;
    },
  });
  assert.deepEqual(
    await authorizeTask(editor, 42, "edit", { queryable: q }),
    { ok: true, uid: 12, projectId: 9 },
  );
  assert.deepEqual(lookedUp, [7, 9]);
});

test("authorizeTask honors primary scope and reports the last denial", async () => {
  const primaryLookups: number[] = [];
  const primaryQuery = authQueryable({
    context: { default_project_id: 7, project_ids: [7, 9] },
    access: (_uid, projectId) => {
      primaryLookups.push(projectId);
      return projectId === 9 ? { role: "editor" } : undefined;
    },
  });
  assert.deepEqual(
    await authorizeTask(editor, 42, "edit", { scope: "primary", queryable: primaryQuery }),
    { ok: false, status: 403, error: "project access denied" },
  );
  assert.deepEqual(primaryLookups, [7]);

  const lastDenial = authQueryable({
    context: { default_project_id: 7, project_ids: [7, 9] },
    access: (_uid, projectId) => (projectId === 7 ? undefined : { role: "viewer" }),
  });
  assert.deepEqual(
    await authorizeTask(editor, 42, "edit", { queryable: lastDenial }),
    { ok: false, status: 403, error: "insufficient project role" },
  );
});

test("authorizeTask fails closed for missing and projectless tasks", async () => {
  assert.deepEqual(
    await authorizeTask(editor, 999, "edit", { queryable: authQueryable() }),
    { ok: false, status: 404, error: "task not found" },
  );
  const projectless = () => authQueryable({
    context: { default_project_id: null, project_ids: [] },
  });
  assert.deepEqual(
    await authorizeTask(editor, 50, "edit", { queryable: projectless() }),
    { ok: false, status: 404, error: "task not found" },
  );
  assert.deepEqual(
    await authorizeTask(admin, 50, "edit", { queryable: projectless() }),
    { ok: true, uid: 13, projectId: null },
  );
  const membershipsOnly = () => authQueryable({
    context: { default_project_id: null, project_ids: [9] },
  });
  assert.deepEqual(
    await authorizeTask(editor, 50, "edit", { scope: "primary", queryable: membershipsOnly() }),
    { ok: false, status: 404, error: "task not found" },
  );
  assert.deepEqual(
    await authorizeTask(admin, 50, "edit", { scope: "primary", queryable: membershipsOnly() }),
    { ok: true, uid: 13, projectId: null },
  );
});

test("request wrappers preserve the unauthenticated contract", async () => {
  const req = () => new Request("http://localhost/api");
  assert.deepEqual(
    await requireProjectPermission(req(), 1, "view"),
    { ok: false, status: 403, error: "unauthenticated" },
  );
  assert.deepEqual(
    await requireWorkspaceAdmin(req()),
    { ok: false, status: 403, error: "workspace admin required" },
  );
  assert.deepEqual(
    await requireActiveUser(req()),
    { ok: false, status: 403, error: "unknown or inactive user" },
  );
});

test("requireTaskPermission resolves the task before the session", async () => {
  assert.deepEqual(
    await requireTaskPermission(new Request("http://localhost/api"), 999, "edit", {
      queryable: authQueryable(),
    }),
    { ok: false, status: 404, error: "task not found" },
  );
  assert.deepEqual(
    await requireTaskPermission(new Request("http://localhost/api"), 42, "edit", {
      queryable: authQueryable({ context: { default_project_id: 7, project_ids: [7] } }),
    }),
    { ok: false, status: 403, error: "unauthenticated" },
  );
  assert.deepEqual(
    await requireTaskPermission(new Request("http://localhost/api"), 50, "edit", {
      queryable: authQueryable({ context: { default_project_id: null, project_ids: [] } }),
    }),
    { ok: false, status: 404, error: "task not found" },
  );
});
