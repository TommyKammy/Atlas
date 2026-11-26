// Development-project settings, the workspace switch and key display against
// PostgreSQL (docs/dev-projects-phase0.md §9). Run with `node --import tsx`;
// DATABASE_URL points at a database with init.sql and the migrations applied.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, mock, test } from "node:test";
import pg from "pg";

const require = createRequire(import.meta.url);
const connectionMarker = mock.method(require("next/server"), "connection", async () => {});
const redisClient = mock.method(require("redis"), "createClient", () => ({
  isReady: false,
  on() {},
  connect: () => Promise.reject(new Error("redis is not used in these tests")),
  destroy() {},
}));
after(() => {
  connectionMarker.mock.restore();
  redisClient.mock.restore();
});
const {
  enableDevProject, getDevProjectSettings, updateDevProject,
} = await import("../lib/services/dev-projects.ts");
const { getWorkspaceFeatures, updateWorkspaceFeatures } = await import("../lib/services/workspace-features.ts");
const { displayTaskKey, lookupTaskKey, lookupProjectPrefix } = await import("../lib/services/task-key-lookup.ts");
const { searchTasksAdvanced } = await import("../lib/services/authorized-data.ts");

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
after(() => db.end());

const OPTIONS = ["未着手", "進行中", "完了"];

function uniquePrefix() {
  return `U${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 10);
}

async function user(name) {
  const { rows: [row] } = await db.query("INSERT INTO users (name) VALUES ($1) RETURNING id", [name]);
  return { uid: Number(row.id), source: "web" };
}

async function project(name, members) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name, status_options) VALUES (1, $1, $2::jsonb) RETURNING id",
    [name, JSON.stringify(OPTIONS)],
  );
  for (const [member, role] of members) {
    await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)", [row.id, member.uid, role]);
  }
  return Number(row.id);
}

async function setAllowed(allowed) {
  const admin = await user("Feature admin");
  await updateWorkspaceFeatures(admin.uid, 1, { dev_projects: allowed });
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { status: error.status, code: error.code, message: error.message };
  }
  assert.fail("expected a rejection");
}

// Tests share the workspace switch, so they run one after another.
test("the workspace switch is audited only when it changes and gates enabling", async () => {
  const admin = await user("Switch admin");
  const owner = await user("Switch owner");
  const projectId = await project("Switch project", [[owner, "admin"]]);
  await updateWorkspaceFeatures(admin.uid, 1, { dev_projects: false });
  const { rows: [{ before }] } = await db.query(
    "SELECT count(*)::int AS before FROM audit_log WHERE action LIKE 'workspace.feature_%'",
  );

  assert.deepEqual(await failure(enableDevProject(owner, projectId, { prefix: uniquePrefix() })), {
    status: 403, code: "dev_projects_disabled", message: "development projects are not enabled for this workspace",
  });
  assert.equal((await getDevProjectSettings(owner, projectId)).allowed, false);

  assert.deepEqual(await updateWorkspaceFeatures(admin.uid, 1, { dev_projects: true }), { dev_projects: true });
  await updateWorkspaceFeatures(admin.uid, 1, { dev_projects: true });
  const { rows: [{ after: afterCount }] } = await db.query(
    "SELECT count(*)::int AS after FROM audit_log WHERE action LIKE 'workspace.feature_%'",
  );
  assert.equal(afterCount, before + 1, "a repeated value records nothing");
  assert.deepEqual(await getWorkspaceFeatures(1), { dev_projects: true });

  const prefix = uniquePrefix();
  const enabled = await enableDevProject(owner, projectId, { prefix, start_status: "進行中" });
  assert.equal(enabled.prefix, prefix);
  const view = await getDevProjectSettings(owner, projectId);
  assert.equal(view.allowed, true);
  assert.deepEqual(view.dev && { ...view.dev, enabled_at: "x" }, {
    prefix, branch_prefix: prefix.toLowerCase(), start_status: "進行中", old_prefixes: [], enabled_at: "x",
  });
  assert.deepEqual(view.status_options, OPTIONS);

  assert.deepEqual(await failure(updateWorkspaceFeatures(admin.uid, 1, { dev_projects: "yes" })), {
    status: 400, code: "bad_request", message: "dev_projects must be a boolean",
  });
});

test("renaming the prefix keeps old keys working and the branch prefix unchanged", async () => {
  await setAllowed(true);
  const owner = await user("Rename owner");
  const projectId = await project("Rename project", [[owner, "admin"]]);
  const first = uniquePrefix();
  await enableDevProject(owner, projectId, { prefix: first });
  const { rows: [{ id: taskId }] } = await db.query(
    "INSERT INTO tasks (project_id, name) VALUES ($1, 'keyed') RETURNING id", [projectId],
  );

  const second = uniquePrefix();
  const renamed = await updateDevProject(owner, projectId, { prefix: second.toLowerCase() });
  assert.equal(renamed.dev.prefix, second);
  assert.equal(renamed.dev.branch_prefix, first.toLowerCase());
  assert.deepEqual(renamed.dev.old_prefixes, [first]);
  assert.equal(await lookupTaskKey(`${first}-1`), Number(taskId));
  assert.equal(await lookupTaskKey(`${second}-1`), Number(taskId));
  assert.equal(await displayTaskKey(Number(taskId)), `${second}-1`);

  // Switching back to an earlier prefix is allowed and adds no new row.
  const back = await updateDevProject(owner, projectId, { prefix: first });
  assert.equal(back.dev.prefix, first);
  assert.deepEqual(back.dev.old_prefixes, [second]);
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM dev_project_prefixes WHERE namespace_id = (SELECT id FROM dev_projects WHERE project_id = $1)",
    [projectId],
  );
  assert.equal(n, 2);

  // Another project cannot take any of them.
  const other = await project("Rename other", [[owner, "admin"]]);
  const otherPrefix = uniquePrefix();
  await enableDevProject(owner, other, { prefix: otherPrefix });
  for (const taken of [first, second]) {
    assert.deepEqual(await failure(updateDevProject(owner, other, { prefix: taken })), {
      status: 409, code: "conflict", message: "prefix is already used in this workspace",
    });
  }
  assert.equal(await lookupProjectPrefix(second), projectId);

  const { rows: audits } = await db.query(
    "SELECT summary FROM audit_log WHERE action = 'project.dev_update' AND entity_id = $1 ORDER BY id", [projectId],
  );
  assert.deepEqual(audits.map((row) => row.summary), [`接頭辞 ${first} → ${second}`, `接頭辞 ${second} → ${first}`]);
});

test("the start status must be one of the options and can be cleared", async () => {
  await setAllowed(true);
  const owner = await user("Start owner");
  const projectId = await project("Start project", [[owner, "admin"]]);
  await enableDevProject(owner, projectId, { prefix: uniquePrefix() });
  assert.equal((await updateDevProject(owner, projectId, { start_status: "進行中" })).dev.start_status, "進行中");
  assert.deepEqual(await failure(updateDevProject(owner, projectId, { start_status: "存在しない" })), {
    status: 400, code: "bad_request", message: "start_status must be one of the project status options",
  });
  assert.equal((await updateDevProject(owner, projectId, { start_status: null })).dev.start_status, null);
  assert.deepEqual(await failure(updateDevProject(owner, projectId, {})), {
    status: 400, code: "bad_request", message: "prefix or start_status required",
  });
});

test("settings need configure access, an enabled project and the workspace switch", async () => {
  await setAllowed(true);
  const owner = await user("Gate owner");
  const commenter = await user("Gate commenter");
  const projectId = await project("Gate project", [[owner, "admin"], [commenter, "commenter"]]);
  assert.equal((await failure(getDevProjectSettings(commenter, projectId))).status, 403);
  assert.deepEqual(await failure(updateDevProject(owner, projectId, { start_status: null })), {
    status: 409, code: "conflict", message: "project is not a development project",
  });
  await enableDevProject(owner, projectId, { prefix: uniquePrefix() });
  await setAllowed(false);
  assert.equal((await failure(updateDevProject(owner, projectId, { start_status: null }))).code, "dev_projects_disabled");
  // Existing keys keep working with the switch off.
  const { rows: [{ id }] } = await db.query("INSERT INTO tasks (project_id, name) VALUES ($1, 'still keyed') RETURNING id", [projectId]);
  assert.match(await displayTaskKey(Number(id)), /^U[0-9A-F]+-1$/);
  await setAllowed(true);
});

test("a key is displayed only while the task's primary project is a development project", async () => {
  await setAllowed(true);
  const owner = await user("Display owner");
  const dev = await project("Display dev", [[owner, "admin"]]);
  const plain = await project("Display plain", [[owner, "admin"]]);
  const prefix = uniquePrefix();
  await enableDevProject(owner, dev, { prefix });
  const { rows: [{ id }] } = await db.query("INSERT INTO tasks (project_id, name) VALUES ($1, 'shown') RETURNING id", [dev]);
  assert.equal(await displayTaskKey(Number(id)), `${prefix}-1`);
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [plain, id]);
  assert.equal(await displayTaskKey(Number(id)), null);
  assert.equal(await lookupTaskKey(`${prefix}-1`), Number(id), "the key still resolves");
});

test("the screens' task search puts an exact key first, only for viewers", async () => {
  await setAllowed(true);
  const owner = await user("Search owner");
  const outsider = await user("Search outsider");
  const dev = await project("Screen search dev", [[owner, "admin"]]);
  const prefix = uniquePrefix();
  await enableDevProject(owner, dev, { prefix });
  const { rows: [{ id }] } = await db.query("INSERT INTO tasks (project_id, name) VALUES ($1, 'target') RETURNING id", [dev]);
  await db.query("INSERT INTO tasks (project_id, name) VALUES ($1, $2)", [dev, `${prefix}-1 mentioned in a name`]);
  const filters = (q) => ({
    q, projectId: null, assigneeId: null, completed: "all", status: null, dueFrom: null, dueTo: null,
    createdFrom: null, createdTo: null, completedFrom: null, completedTo: null, custom: [],
  });
  const query = `${prefix.toLowerCase()}-1`;
  const keyTaskId = await lookupTaskKey(query);
  const mine = await searchTasksAdvanced(1, { ...filters(query), keyTaskId }, { userId: owner.uid });
  assert.equal(mine[0]?.id, Number(id));
  const theirs = await searchTasksAdvanced(1, { ...filters(query), keyTaskId }, { userId: outsider.uid });
  assert.ok(!theirs.some((task) => task.id === Number(id)));
});
