// Issue-key resolution and MCP read services against PostgreSQL
// (docs/dev-projects-phase0.md §5, §8, §10). Run with `node --import tsx`;
// DATABASE_URL points at a database with init.sql and the migrations applied.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, mock, test } from "node:test";
import pg from "pg";

// The services run their production SQL; only Next's request marker is
// unavailable outside a request handler.
const nextServer = createRequire(import.meta.url)("next/server");
const connectionMarker = mock.method(nextServer, "connection", async () => {});
after(() => connectionMarker.mock.restore());
const { getTaskDetail, listProjects, searchTasks } = await import("../lib/services/queries.ts");
const { resolveProjectRef, resolveTaskRef, taskKeysFor } = await import("../lib/services/task-keys.ts");

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
after(() => db.end());

function uniquePrefix() {
  return `R${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 10);
}

async function user(name) {
  const { rows: [row] } = await db.query("INSERT INTO users (name) VALUES ($1) RETURNING id", [name]);
  return { uid: Number(row.id), source: "mcp" };
}

async function project(name, members = []) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES (1, $1) RETURNING id", [name],
  );
  for (const member of members) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')",
      [row.id, member.uid],
    );
  }
  return Number(row.id);
}

async function task(projectId, name) {
  const { rows: [row] } = await db.query(
    "INSERT INTO tasks (project_id, name) VALUES ($1, $2) RETURNING id", [projectId, name],
  );
  return Number(row.id);
}

async function enable(projectId, prefix) {
  await db.query("SELECT atlas_enable_dev_project($1, $2, NULL, NULL, 20000)", [projectId, prefix]);
}

/** The error a call rejects with, reduced to what a caller can observe. */
async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { status: error.status, code: error.code, message: error.message };
  }
  assert.fail("expected a rejection");
}

const TASK_NOT_FOUND = { status: 404, code: "not_found", message: "task not found" };
const PROJECT_NOT_FOUND = { status: 404, code: "not_found", message: "project not found" };

test("a key resolves for a member in any letter case and the detail carries it", async () => {
  const member = await user("Resolve member");
  const dev = await project("Resolve dev", [member]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  const id = await task(dev, "keyed");
  assert.equal(await resolveTaskRef(member, `${prefix.toLowerCase()}-1`), id);
  assert.equal(await resolveTaskRef(member, id), id, "numeric ids pass through");
  assert.equal((await getTaskDetail(member, id)).task.key, `${prefix}-1`);
});

test("an unknown key and a key the actor cannot view fail the same way", async () => {
  const member = await user("Hidden member");
  const outsider = await user("Hidden outsider");
  const dev = await project("Hidden dev", [member]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  await task(dev, "secret");
  const hidden = await failure(resolveTaskRef(outsider, `${prefix}-1`));
  const unknownNumber = await failure(resolveTaskRef(outsider, `${prefix}-999`));
  const unknownPrefix = await failure(resolveTaskRef(outsider, `${uniquePrefix()}-1`));
  assert.deepEqual(hidden, TASK_NOT_FOUND);
  assert.deepEqual(unknownNumber, TASK_NOT_FOUND);
  assert.deepEqual(unknownPrefix, TASK_NOT_FOUND);
  assert.deepEqual(await failure(resolveTaskRef(outsider, "not a key")), {
    status: 400, code: "bad_request", message: "task must be a numeric id or a key such as ATL-123",
  });
});

test("project prefixes resolve for viewers and hide projects from others", async () => {
  const member = await user("Prefix member");
  const outsider = await user("Prefix outsider");
  const dev = await project("Prefix dev", [member]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  assert.equal(await resolveProjectRef(member, prefix.toLowerCase()), dev);
  assert.deepEqual(await failure(resolveProjectRef(outsider, prefix)), PROJECT_NOT_FOUND);
  assert.deepEqual(await failure(resolveProjectRef(outsider, uniquePrefix())), PROJECT_NOT_FOUND);
  const listed = await listProjects(member, { query: "Prefix dev" });
  assert.deepEqual(listed.items.find((item) => item.id === dev)?.dev, { prefix, start_status: null });
});

test("old prefixes keep resolving and keys show the current prefix", async () => {
  // Prefix renames arrive with the settings screen; simulate one here.
  const member = await user("Rename member");
  const dev = await project("Rename dev", [member]);
  const oldPrefix = uniquePrefix();
  await enable(dev, oldPrefix);
  const id = await task(dev, "renamed");
  const newPrefix = uniquePrefix();
  const { rows: [{ id: namespace }] } = await db.query("SELECT id FROM dev_projects WHERE project_id = $1", [dev]);
  await db.query("UPDATE dev_projects SET prefix = $2 WHERE id = $1", [namespace, newPrefix]);
  await db.query(
    "INSERT INTO dev_project_prefixes (workspace_id, prefix, namespace_id) VALUES (1, $1, $2)",
    [newPrefix, namespace],
  );
  assert.equal(await resolveTaskRef(member, `${oldPrefix}-1`), id);
  assert.equal(await resolveTaskRef(member, `${newPrefix}-1`), id);
  assert.equal(await resolveProjectRef(member, oldPrefix), dev);
  assert.equal((await taskKeysFor([id])).get(id), `${newPrefix}-1`);
});

test("a task moved to an ordinary project keeps its key and resolves by it", async () => {
  const member = await user("Move member");
  const dev = await project("Move dev", [member]);
  const plain = await project("Move plain", [member]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  const id = await task(dev, "moved");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [plain, id]);
  assert.equal(await resolveTaskRef(member, `${prefix}-1`), id);
  assert.equal((await getTaskDetail(member, id)).task.key, `${prefix}-1`);
  const page = await searchTasks(member, { projectId: plain });
  assert.equal(page.items.find((item) => item.id === id)?.key, `${prefix}-1`);
});

test("a hard-deleted development project's prefix is gone but moved tasks still resolve", async () => {
  const member = await user("Deleted member");
  const dev = await project("Deleted dev", [member]);
  const plain = await project("Deleted plain", [member]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  const id = await task(dev, "survivor");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [plain, id]);
  await db.query("DELETE FROM projects WHERE id = $1", [dev]);
  assert.deepEqual(await failure(resolveProjectRef(member, prefix)), PROJECT_NOT_FOUND);
  assert.equal(await resolveTaskRef(member, `${prefix}-1`), id);
});

test("an exact key query finds the task first, but only for viewers and within the filters", async () => {
  const member = await user("Search member");
  const outsider = await user("Search outsider");
  const dev = await project("Search dev", [member]);
  const other = await project("Search other", [member, outsider]);
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  const target = await task(dev, "target without the key in its name");
  // A task whose name mentions the key would rank first on the text alone.
  await task(dev, `${prefix}-1`);

  const page = await searchTasks(member, { query: `${prefix.toLowerCase()}-1` });
  assert.equal(page.items[0]?.id, target);
  assert.equal(page.items[0]?.key, `${prefix}-1`);

  const hidden = await searchTasks(outsider, { query: `${prefix}-1` });
  assert.ok(!hidden.items.some((item) => item.id === target), "no match for an outsider");

  const filtered = await searchTasks(member, { query: `${prefix}-1`, projectId: other });
  assert.ok(!filtered.items.some((item) => item.id === target), "the project filter still applies");

  const done = await searchTasks(member, { query: `${prefix}-1`, completed: "done" });
  assert.ok(!done.items.some((item) => item.id === target), "the completion filter still applies");
});
