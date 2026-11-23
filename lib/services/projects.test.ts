import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import type { Actor } from "./actor";
import {
  createProject,
  createProjectFromTemplate,
  updateProject,
} from "./projects";

type AuthOptions = {
  /** true grants projects.create through the legacy member role. */
  canCreate?: boolean;
  role?: string | null;
  settings?: unknown;
};

const actor: Actor = { uid: 13, source: "web" };

/** Minimal Queryable for RBAC, loadAuthActor, getProjectAccess and project policy. */
function mockAuthQueries(options: AuthOptions, calls: string[]) {
  return async (sql: string) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("LEFT JOIN workspace_roles")) {
      rows = options.canCreate
        ? [{
            id: 13,
            is_admin: false,
            is_guest: false,
            role_id: null,
            key: null,
            name: null,
            base_level: null,
            permissions: null,
            is_super: null,
          }]
        : [{
            id: 13,
            is_admin: false,
            is_guest: false,
            role_id: 9,
            key: "limited",
            name: "Limited",
            base_level: "member",
            permissions: [],
            is_super: false,
          }];
    } else if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      rows = [{ is_admin: false, is_guest: false, deactivated_at: null }];
    } else if (sql.includes("LEFT JOIN project_members")) {
      rows = [{ is_admin: false, deactivated_at: null, role: options.role ?? null }];
    } else if (sql.includes("SELECT settings FROM projects")) {
      rows = [{ settings: options.settings ?? {} }];
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

test("createProject rejects an actor without projects.create before reading the body", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ canCreate: false }, calls));
  await assertApiError(
    createProject(actor, { workspace_id: 1, name: "Project" }),
    403,
    "permission denied",
    "forbidden",
  );
  assert.equal(calls.length, 1);
});

test("createProject requires workspace_id and name after the permission check", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ canCreate: true }, calls));
  await assertApiError(
    createProject(actor, { workspace_id: 1 }),
    400,
    "workspace_id and name are required",
    "bad_request",
  );
  await assertApiError(
    createProject(actor, { name: "Project" }),
    400,
    "workspace_id and name are required",
    "bad_request",
  );
  assert.equal(calls.length, 2);
});

test("createProjectFromTemplate rejects an actor without projects.create", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ canCreate: false }, calls));
  await assertApiError(
    createProjectFromTemplate(actor, 5, { name: "From template" }),
    403,
    "permission denied",
    "forbidden",
  );
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((sql) => sql.includes("FROM project_templates")));
});

test("updateProject rejects a project where the actor cannot configure", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ role: "viewer" }, calls));
  await assertApiError(
    updateProject(actor, 7, { name: "Renamed" }),
    403,
    "insufficient project role",
    "forbidden",
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => sql.includes("UPDATE projects")));
});

test("updateProject rejects admin-only fields for an editor who can configure", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({
    role: "editor",
    settings: { who_can_edit: "editors" },
  }, calls));
  await assertApiError(
    updateProject(actor, 7, { settings: { who_can_edit: "admins" } }),
    403,
    "project administration requires an admin",
    "forbidden",
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => sql.includes("UPDATE projects")));
});

test("updateProject rejects an invalid status_color", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ role: "admin" }, calls));
  await assertApiError(
    updateProject(actor, 7, { status_color: "purple" }),
    400,
    "invalid status_color",
    "bad_request",
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => sql.includes("UPDATE projects")));
});
