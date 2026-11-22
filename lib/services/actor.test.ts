import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db, type Queryable } from "../db";
import {
  loadAuthActor,
  requireNotGuest,
  requireProjectAccess,
  requireTaskAccess,
  requireWorkspacePermission,
  type Actor,
} from "./actor";

type UserFlags = {
  is_admin?: boolean;
  is_guest?: boolean;
  deactivated_at?: string | null;
  /** Role used for every project unless `roles` overrides it. */
  role?: string | null;
  /** Per-project role overrides; null means "not a member". */
  roles?: Record<number, string | null>;
};

type TaskContext = {
  default_project_id: number | null;
  project_ids: Array<number | string> | null;
};

/**
 * Minimal Queryable covering the SQL used by loadAuthActor, getProjectAccess,
 * getProjectPolicyAccess, getEffectiveRole, and getTaskProjectContext.
 */
function authQueryable(options: {
  users?: Record<number, UserFlags>;
  context?: TaskContext | null;
  settings?: Record<string, unknown>;
} = {}): Queryable {
  return {
    query: async (sql, params) => {
      const uid = Number(params?.[0]);
      const user = options.users?.[uid];
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("AS default_project_id")) {
        rows = options.context ? [{ ...options.context }] : [];
      } else if (sql.includes("LEFT JOIN workspace_roles")) {
        rows = user && user.deactivated_at == null
          ? [{
              id: uid,
              is_admin: user.is_admin ?? false,
              is_guest: user.is_guest ?? false,
              role_id: null,
              key: null,
              name: null,
              base_level: null,
              permissions: null,
              is_super: null,
            }]
          : [];
      } else if (sql.includes("SELECT settings FROM projects")) {
        rows = [{ settings: options.settings ?? {} }];
      } else if (sql.includes("LEFT JOIN project_members")) {
        if (user) {
          const projectId = Number(params?.[1]);
          const role = user.roles && projectId in user.roles
            ? user.roles[projectId]
            : (user.role ?? null);
          rows = [{
            is_admin: user.is_admin ?? false,
            deactivated_at: user.deactivated_at ?? null,
            role,
          }];
        }
      } else if (sql.includes("FROM users")) {
        rows = user
          ? [{
              is_admin: user.is_admin ?? false,
              is_guest: user.is_guest ?? false,
              deactivated_at: user.deactivated_at ?? null,
            }]
          : [];
      } else {
        throw new Error(`unexpected query: ${sql}`);
      }
      return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
    },
  };
}

const USERS: Record<number, UserFlags> = {
  11: { role: "viewer" },
  12: { role: "commenter" },
  13: { role: "editor" },
  14: { is_admin: true },
  15: { role: "editor", deactivated_at: "2026-01-01T00:00:00Z" },
  16: { is_guest: true },
};

const PROJECTLESS_TASK: TaskContext = { default_project_id: null, project_ids: [] };

const actor = (uid: number, source: Actor["source"] = "web"): Actor => ({ uid, source });

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

test("loadAuthActor re-reads live user flags on every call", async () => {
  const users: Record<number, UserFlags> = { 11: { role: "viewer" } };
  const q = authQueryable({ users });
  assert.deepEqual(
    await loadAuthActor(actor(11), q),
    { uid: 11, isAdmin: false, isGuest: false },
  );
  users[11] = { ...users[11], is_admin: true };
  assert.deepEqual(
    await loadAuthActor(actor(11), q),
    { uid: 11, isAdmin: true, isGuest: false },
  );
  assert.equal(await loadAuthActor(actor(99), q), null);
});

test("loadAuthActor rejects deactivated users", async () => {
  const q = authQueryable({ users: USERS });
  assert.equal(await loadAuthActor(actor(15), q), null);
});

test("viewer can view a project but cannot edit it", async () => {
  const q = authQueryable({ users: USERS });
  assert.deepEqual(
    await requireProjectAccess(actor(11), 7, "view", q),
    { ok: true, uid: 11, role: "viewer", workspaceAdmin: false },
  );
  await assertApiError(
    requireProjectAccess(actor(11), 7, "edit", q),
    403,
    "insufficient project role",
    "forbidden",
  );
});

test("commenter can comment but cannot edit", async () => {
  const q = authQueryable({ users: USERS });
  assert.deepEqual(
    await requireProjectAccess(actor(12), 7, "comment", q),
    { ok: true, uid: 12, role: "commenter", workspaceAdmin: false },
  );
  await assertApiError(
    requireProjectAccess(actor(12), 7, "edit", q),
    403,
    "insufficient project role",
    "forbidden",
  );
});

test("editor can edit a project", async () => {
  const q = authQueryable({ users: USERS });
  assert.deepEqual(
    await requireProjectAccess(actor(13), 7, "edit", q),
    { ok: true, uid: 13, role: "editor", workspaceAdmin: false },
  );
});

test("inactive and unknown users are rejected before project checks", async () => {
  const q = authQueryable({ users: USERS });
  await assertApiError(
    requireProjectAccess(actor(15), 7, "view", q),
    403,
    "unknown or inactive user",
    "forbidden",
  );
  await assertApiError(
    requireProjectAccess(actor(99), 7, "view", q),
    403,
    "unknown or inactive user",
    "forbidden",
  );
  await assertApiError(
    requireTaskAccess(actor(15), 42, "view", { q }),
    403,
    "unknown or inactive user",
    "forbidden",
  );
});

test("project access requires membership", async () => {
  const q = authQueryable({ users: USERS });
  await assertApiError(
    requireProjectAccess(actor(16), 7, "view", q),
    403,
    "project access denied",
    "forbidden",
  );
});

test("task access accepts any project the task belongs to", async () => {
  const q = authQueryable({
    users: { 13: { roles: { 7: null, 9: "editor" } } },
    context: { default_project_id: 7, project_ids: [7, 9] },
  });
  assert.deepEqual(
    await requireTaskAccess(actor(13), 42, "edit", { q }),
    { ok: true, uid: 13, projectId: 9 },
  );
  await assertApiError(
    requireTaskAccess(actor(13), 42, "edit", { scope: "primary", q }),
    403,
    "project access denied",
    "forbidden",
  );
});

test("tasks without a project require a workspace admin", async () => {
  const q = authQueryable({ users: USERS, context: PROJECTLESS_TASK });
  await assertApiError(
    requireTaskAccess(actor(13), 50, "edit", { q }),
    404,
    "task not found",
    "not_found",
  );
  await assertApiError(
    requireTaskAccess(actor(11), 50, "view", { q }),
    404,
    "task not found",
    "not_found",
  );
  assert.deepEqual(
    await requireTaskAccess(actor(14), 50, "edit", { q }),
    { ok: true, uid: 14, projectId: null },
  );
});

test("a missing task is reported as not found", async () => {
  const q = authQueryable({ users: USERS, context: null });
  await assertApiError(
    requireTaskAccess(actor(13), 999, "edit", { q }),
    404,
    "task not found",
    "not_found",
  );
});

test("requireNotGuest rejects guests but accepts members", async () => {
  const q = authQueryable({ users: USERS });
  await assertApiError(
    requireNotGuest(actor(16, "mcp"), q),
    403,
    "guest users cannot use MCP",
    "forbidden",
  );
  await requireNotGuest(actor(11, "mcp"), q);
  await assertApiError(
    requireNotGuest(actor(15, "mcp"), q),
    403,
    "unknown or inactive user",
    "forbidden",
  );
});

test("requireWorkspacePermission enforces RBAC and inactive users", async (t) => {
  t.mock.method(db, "query", async (text: string, params?: unknown[]) =>
    authQueryable({ users: USERS }).query(text, params),
  );
  await requireWorkspacePermission(actor(11), "projects.create");
  await assertApiError(
    requireWorkspacePermission(actor(11), "roles.manage"),
    403,
    "permission denied",
    "forbidden",
  );
  await assertApiError(
    requireWorkspacePermission(actor(15), "projects.create"),
    403,
    "permission denied",
    "forbidden",
  );
  await assertApiError(
    requireWorkspacePermission(actor(16), "projects.create"),
    403,
    "permission denied",
    "forbidden",
  );
});

test("npm test runs the service test files", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.ok(
    (pkg.scripts?.test ?? "").includes("lib/services/*.test.ts"),
    "package.json test script must include lib/services/*.test.ts",
  );
});
