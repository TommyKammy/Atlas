// start_task and the start status's tracking of status renames against
// PostgreSQL (docs/dev-projects-phase0.md §6, §10). Run with
// `node --import tsx`; DATABASE_URL points at a database with init.sql and
// the migrations applied.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, mock, test } from "node:test";
import pg from "pg";

// The services run their production SQL; only Next's request marker is
// unavailable outside a request handler. Live notifications are best effort
// and skipped without a Redis client.
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
const { startTask } = await import("../lib/services/task-start.ts");
const { updateProject } = await import("../lib/services/projects.ts");
const { updateTaskForActor } = await import("../lib/services/task-actions.ts");
const { createTask } = await import("../lib/services/task-create.ts");
const { runWithRequestContext } = await import("../lib/request-context.ts");
const { createWriteTools, DEFAULT_MCP_WRITE_SERVICES } = await import("../lib/mcp/server.ts");

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
after(() => db.end());

const OPTIONS = ["未着手", "進行中", "レビュー", "完了"];

function uniquePrefix() {
  return `S${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 10);
}

async function user(name) {
  const { rows: [row] } = await db.query("INSERT INTO users (name) VALUES ($1) RETURNING id", [name]);
  return { uid: Number(row.id), source: "mcp" };
}

/** A development project whose members are given as [actor, role] pairs. */
async function devProject(name, members, { startStatus = "進行中", options = OPTIONS } = {}) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name, status_options) VALUES (1, $1, $2::jsonb) RETURNING id",
    [name, JSON.stringify(options)],
  );
  const projectId = Number(row.id);
  for (const [member, role] of members) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)",
      [projectId, member.uid, role],
    );
  }
  const prefix = uniquePrefix();
  await db.query("SELECT atlas_enable_dev_project($1, $2, $3, NULL, 20000)", [projectId, prefix, startStatus]);
  return { projectId, prefix, branchPrefix: prefix.toLowerCase() };
}

async function task(projectId, name, fields = {}) {
  const { rows: [row] } = await db.query(
    `INSERT INTO tasks (project_id, name, status, assignee_id, completed, completed_at, recurrence)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() END, $6) RETURNING id`,
    [projectId, name, fields.status ?? "inbox", fields.assignee ?? null, fields.completed ?? false,
      fields.recurrence ?? "none"],
  );
  return Number(row.id);
}

async function taskRow(id) {
  const { rows: [row] } = await db.query(
    "SELECT status, assignee_id, completed, completed_at FROM tasks WHERE id = $1", [id],
  );
  return row;
}

/** How many history, audit and domain-event rows a task has. */
async function trail(id) {
  const { rows: [row] } = await db.query(
    `SELECT (SELECT count(*)::int FROM task_events WHERE task_id = $1) AS events,
            (SELECT count(*)::int FROM audit_log WHERE entity = 'task' AND entity_id = $1) AS audits,
            (SELECT count(*)::int FROM domain_events WHERE subject_type = 'task' AND subject_id = $1) AS domain`,
    [id],
  );
  return row;
}

function viaMcp(fn) {
  return runWithRequestContext({ via: "mcp", tokenId: null, clientName: "regression-client" }, fn);
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { reason: error.reason, conflict: error.metadata?.conflict, metadata: error.metadata, status: error.status };
  }
  assert.fail("expected a rejection");
}

test("an unassigned issue is assigned, moved to the start status and recorded once", async () => {
  const agent = await user("Start agent");
  const dev = await devProject("Start project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "unassigned");

  const first = await viaMcp(() => startTask(agent, id));
  assert.deepEqual(first.changed, { assignee: true, status: true, reopened: false });
  assert.equal(first.key, `${dev.prefix}-1`);
  assert.equal(first.branchName, `${dev.branchPrefix}-1`);
  const row = await taskRow(id);
  assert.equal(row.assignee_id, agent.uid);
  assert.equal(row.status, "進行中");

  const { rows: events } = await db.query(
    "SELECT kind, via, client_name FROM task_events WHERE task_id = $1 AND kind = 'started'", [id],
  );
  assert.deepEqual(events, [{ kind: "started", via: "mcp", client_name: "regression-client" }]);
  const { rows: domain } = await db.query(
    "SELECT type FROM domain_events WHERE subject_type = 'task' AND subject_id = $1 ORDER BY id", [id],
  );
  assert.deepEqual(domain.map((event) => event.type).filter((type) => type !== "task.created"),
    ["task.assigned", "task.status_changed"]);
  const { rows: audits } = await db.query(
    "SELECT action, summary, via FROM audit_log WHERE entity = 'task' AND entity_id = $1", [id],
  );
  assert.deepEqual(audits, [{ action: "task.update", summary: "assignee_id,status", via: "mcp" }]);

  // A repeat returns the same branch and records nothing.
  const before = await trail(id);
  const again = await viaMcp(() => startTask(agent, id));
  assert.deepEqual(again.changed, { assignee: false, status: false, reopened: false });
  assert.equal(again.branchName, first.branchName);
  assert.deepEqual(await trail(id), before);
});

test("an issue assigned to someone else is a conflict that changes nothing", async () => {
  const agent = await user("Other agent");
  const owner = await user("Other owner");
  const dev = await devProject("Other project", [[agent, "editor"], [owner, "editor"]]);
  const id = await task(dev.projectId, "taken", { assignee: owner.uid, status: "未着手" });
  const before = await trail(id);
  const result = await failure(startTask(agent, id));
  assert.equal(result.conflict, "assigned_to_other");
  assert.deepEqual(result.metadata.assignee, { id: owner.uid, name: "Other owner" });
  assert.equal((await taskRow(id)).status, "未着手");
  assert.deepEqual(await trail(id), before);
});

test("an issue already assigned to the actor only moves its status", async () => {
  const agent = await user("Self agent");
  const dev = await devProject("Self project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "mine", { assignee: agent.uid, status: "未着手" });
  const started = await startTask(agent, id);
  assert.deepEqual(started.changed, { assignee: false, status: true, reopened: false });
});

test("the status moves only when it is before the start status or outside the options", async () => {
  const agent = await user("Order agent");
  const dev = await devProject("Order project", [[agent, "editor"]]);
  const cases = [["未着手", "進行中"], ["進行中", "進行中"], ["レビュー", "レビュー"], ["inbox", "進行中"]];
  for (const [status, expected] of cases) {
    const id = await task(dev.projectId, `status ${status}`, { assignee: agent.uid, status });
    await startTask(agent, id);
    assert.equal((await taskRow(id)).status, expected, status);
  }
});

test("without a start status or with the status field disabled only the assignee changes", async () => {
  const agent = await user("Unset agent");
  const unset = await devProject("Unset project", [[agent, "editor"]], { startStatus: null });
  const a = await task(unset.projectId, "no start status", { status: "未着手" });
  assert.deepEqual((await startTask(agent, a)).changed, { assignee: true, status: false, reopened: false });
  assert.equal((await taskRow(a)).status, "未着手");

  const disabled = await devProject("Disabled project", [[agent, "editor"]]);
  await db.query("UPDATE projects SET status_field_enabled = false WHERE id = $1", [disabled.projectId]);
  const b = await task(disabled.projectId, "field disabled", { status: "未着手" });
  assert.deepEqual((await startTask(agent, b)).changed, { assignee: true, status: false, reopened: false });
  assert.equal((await taskRow(b)).status, "未着手");
});

test("a completed issue needs reopen, which moves a Done status back to the start status", async () => {
  const agent = await user("Reopen agent");
  const dev = await devProject("Reopen project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "done", { assignee: agent.uid, status: "完了", completed: true });
  assert.equal((await failure(startTask(agent, id))).conflict, "completed");
  assert.equal((await taskRow(id)).completed, true);

  const reopened = await startTask(agent, id, { reopen: true });
  assert.deepEqual(reopened.changed, { assignee: false, status: true, reopened: true });
  const row = await taskRow(id);
  assert.equal(row.completed, false);
  assert.equal(row.completed_at, null);
  assert.equal(row.status, "進行中");
  const { rows } = await db.query(
    "SELECT type FROM domain_events WHERE subject_type = 'task' AND subject_id = $1 AND type = 'task.reopened'", [id],
  );
  assert.equal(rows.length, 1);
});

test("a completed recurring issue whose next occurrence exists cannot be reopened", async () => {
  const agent = await user("Recurring agent");
  const dev = await devProject("Recurring project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "daily", { assignee: agent.uid, recurrence: "daily" });
  await updateTaskForActor(agent, id, { completed: true });
  const result = await failure(startTask(agent, id, { reopen: true }));
  assert.equal(result.conflict, "recurring_completed");
  assert.equal((await taskRow(id)).completed, true);
});

test("approval tasks and tasks outside development projects are conflicts", async () => {
  const agent = await user("Approval agent");
  const dev = await devProject("Approval project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "approval");
  await db.query(
    "INSERT INTO task_approvals (task_id, status, requester_id, round, version) VALUES ($1, 'pending', $2, 1, 1)",
    [id, agent.uid],
  );
  assert.equal((await failure(startTask(agent, id))).conflict, "approval_task");
  assert.equal((await taskRow(id)).assignee_id, null);

  const { rows: [plain] } = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES (1, 'Plain project') RETURNING id",
  );
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')", [plain.id, agent.uid]);
  const moved = await task(dev.projectId, "moved out");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [plain.id, moved]);
  assert.equal((await failure(startTask(agent, moved))).conflict, "not_dev_project");
});

test("viewers, outsiders and trashed tasks are refused", async () => {
  const viewer = await user("Viewer");
  const outsider = await user("Outsider");
  const dev = await devProject("Refused project", [[viewer, "viewer"]]);
  const id = await task(dev.projectId, "refused");
  assert.equal((await failure(startTask(viewer, id))).status, 403);
  assert.ok([403, 404].includes((await failure(startTask(outsider, id))).status));
  const editor = await user("Trash editor");
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')", [dev.projectId, editor.uid]);
  await db.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [id]);
  const trashed = await failure(startTask(editor, id));
  assert.ok(trashed.reason === "missing" || trashed.status === 404, JSON.stringify(trashed));
});

test("expected_updated_at guards the start like other task writes", async () => {
  const agent = await user("Stamp agent");
  const dev = await devProject("Stamp project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "stamped");
  const result = await failure(startTask(agent, id, { expectedUpdatedAt: "2000-01-01 00:00:00+00" }));
  assert.equal(result.reason, "conflict");
  assert.equal((await taskRow(id)).assignee_id, null);
});

test("two concurrent starts assign the issue to exactly one of them", async () => {
  const first = await user("Race one");
  const second = await user("Race two");
  const dev = await devProject("Race project", [[first, "editor"], [second, "editor"]]);
  const id = await task(dev.projectId, "contested");
  const results = await Promise.allSettled([startTask(first, id), startTask(second, id)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.metadata.conflict, "assigned_to_other");
  const winner = results[0].status === "fulfilled" ? first : second;
  assert.equal((await taskRow(id)).assignee_id, winner.uid);
});

test("old and new keys give the same branch name after a prefix rename", async () => {
  const agent = await user("Rename agent");
  const dev = await devProject("Rename project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "renamed prefix");
  const newPrefix = uniquePrefix();
  const { rows: [{ id: namespace }] } = await db.query("SELECT id FROM dev_projects WHERE project_id = $1", [dev.projectId]);
  await db.query("UPDATE dev_projects SET prefix = $2 WHERE id = $1", [namespace, newPrefix]);
  await db.query("INSERT INTO dev_project_prefixes (workspace_id, prefix, namespace_id) VALUES (1, $1, $2)", [newPrefix, namespace]);
  const tools = Object.fromEntries(createWriteTools(DEFAULT_MCP_WRITE_SERVICES).map((tool) => [tool.name, tool]));
  const context = { actor: { ...agent, tokenId: undefined }, scopes: ["read", "write"], endpoint: "default", era: "modern" };
  const { rows: [token] } = await db.query(
    `INSERT INTO mcp_tokens (workspace_id, user_id, kind, name, token_hash, scopes)
     VALUES (1, $1, 'pat', 'test', $2, ARRAY['read', 'write']) RETURNING id`,
    [agent.uid, randomBytes(32).toString("hex")],
  );
  context.actor.tokenId = Number(token.id);
  const byOld = await tools.start_task.handler({ task: `${dev.prefix}-1` }, context);
  const byNew = await tools.start_task.handler({ task: `${newPrefix.toLowerCase()}-1` }, context);
  assert.equal(byOld.structuredContent.branch_name, `${dev.branchPrefix}-1`);
  assert.equal(byNew.structuredContent.branch_name, `${dev.branchPrefix}-1`);
  assert.equal(byNew.structuredContent.key, `${newPrefix}-1`);
  assert.equal(byNew.structuredContent.task.id, id);
});

test("updateProject keeps the start status on renames, clears it on removal and keeps it when the field is disabled", async () => {
  const admin = await user("Status admin");
  const dev = await devProject("Status project", [[admin, "admin"]]);
  const version = async () => (await db.query(
    "SELECT status_options_version AS v FROM projects WHERE id = $1", [dev.projectId],
  )).rows[0].v;
  const startStatus = async () => (await db.query(
    "SELECT start_status FROM dev_projects WHERE project_id = $1", [dev.projectId],
  )).rows[0].start_status;

  await updateProject(admin, dev.projectId, {
    status_options: ["未着手", "作業中", "レビュー", "完了"],
    status_renames: [{ from: "進行中", to: "作業中" }],
    expected_status_options_version: await version(),
  });
  assert.equal(await startStatus(), "作業中");

  await updateProject(admin, dev.projectId, { status_field_enabled: false });
  assert.equal(await startStatus(), "作業中");

  await updateProject(admin, dev.projectId, {
    status_options: ["未着手", "レビュー", "完了"],
    expected_status_options_version: await version(),
  });
  assert.equal(await startStatus(), null);
});

test("updateProject waits for a start holding the development settings", async () => {
  const admin = await user("Wait admin");
  const dev = await devProject("Wait project", [[admin, "admin"]]);
  const holder = await db.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM dev_projects WHERE project_id = $1 FOR SHARE", [dev.projectId]);
    const { rows: [{ v }] } = await db.query("SELECT status_options_version AS v FROM projects WHERE id = $1", [dev.projectId]);
    let settled = false;
    // A rename that leaves the start status alone still has to wait: it may
    // rewrite statuses the start is about to read.
    const update = updateProject(admin, dev.projectId, {
      status_options: ["未着手", "進行中", "確認中", "完了"],
      status_renames: [{ from: "レビュー", to: "確認中" }],
      expected_status_options_version: v,
    }).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, "the rename waits for the start's lock");
    await holder.query("COMMIT");
    await update;
  } finally {
    holder.release();
  }
});

test("a start waiting behind a rename writes the new status name, never the removed one", async () => {
  const agent = await user("Serial agent");
  const dev = await devProject("Serial project", [[agent, "editor"]]);
  const id = await task(dev.projectId, "serialized", { status: "未着手" });
  const renamer = await db.connect();
  try {
    // The rename's transaction as updateProject runs it: settings first.
    await renamer.query("BEGIN");
    await renamer.query("SELECT 1 FROM dev_projects WHERE project_id = $1 FOR UPDATE", [dev.projectId]);
    let settled = false;
    const start = startTask(agent, id).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, "the start waits for the rename");
    await renamer.query(
      "UPDATE projects SET status_options = $2::jsonb WHERE id = $1",
      [dev.projectId, JSON.stringify(["未着手", "作業中", "レビュー", "完了"])],
    );
    await renamer.query("UPDATE dev_projects SET start_status = '作業中' WHERE project_id = $1", [dev.projectId]);
    await renamer.query("UPDATE tasks SET status = '作業中' WHERE project_id = $1 AND status = '進行中'", [dev.projectId]);
    await renamer.query("COMMIT");
    await start;
  } finally {
    renamer.release();
  }
  assert.equal((await taskRow(id)).status, "作業中");
});

test("status renames and subtask creation run concurrently without deadlocks", async () => {
  const admin = await user("Deadlock admin");
  const dev = await devProject("Deadlock project", [[admin, "admin"]]);
  const parent = await task(dev.projectId, "parent", { status: "進行中" });
  let names = ["進行中", "作業中"];
  for (let round = 0; round < 10; round++) {
    const { rows: [{ v }] } = await db.query("SELECT status_options_version AS v FROM projects WHERE id = $1", [dev.projectId]);
    const [from, to] = names;
    await Promise.all([
      updateProject(admin, dev.projectId, {
        status_options: ["未着手", to, "レビュー", "完了"],
        status_renames: [{ from, to }],
        expected_status_options_version: v,
      }),
      createTask(admin, { project_id: dev.projectId, parent_task_id: parent, name: `child ${round}` }),
      startTask(admin, parent),
    ]);
    names = [to, from];
  }
  const { rows: [{ start_status: startStatus }] } = await db.query(
    "SELECT start_status FROM dev_projects WHERE project_id = $1", [dev.projectId],
  );
  assert.equal((await taskRow(parent)).status, startStatus);
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A plain project with the given [actor, role] members. */
async function plainProject(name, members) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name, status_options) VALUES (1, $1, $2::jsonb) RETURNING id",
    [name, JSON.stringify(OPTIONS)],
  );
  for (const [member, role] of members) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)",
      [row.id, member.uid, role],
    );
  }
  return Number(row.id);
}

test("a task moved into a project the actor cannot edit is not changed there", async () => {
  const agent = await user("Moved-away agent");
  const owner = await user("Moved-away owner");
  const source = await plainProject("Moved-away source", [[agent, "editor"]]);
  const target = await devProject("Moved-away target", [[owner, "editor"]]);
  const id = await task(source, "moving", { status: "未着手" });
  const mover = await db.connect();
  try {
    // The start passes its access check on the source, then waits for the
    // task while another transaction moves it to the target.
    await mover.query("BEGIN");
    await mover.query("SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE", [id]);
    const start = failure(startTask(agent, id));
    await pause(300);
    await mover.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [target.projectId, id]);
    await mover.query("COMMIT");
    assert.equal((await start).status, 403);
  } finally {
    mover.release();
  }
  const row = await taskRow(id);
  assert.equal(row.assignee_id, null);
  assert.equal(row.status, "未着手");
});

test("a start retrying after a move releases the task before locking the new settings", async () => {
  const agent = await user("Retry agent");
  const source = await plainProject("Retry source", [[agent, "editor"]]);
  const target = await devProject("Retry target", [[agent, "editor"]]);
  const id = await task(source, "retried", { status: "未着手" });
  const mover = await db.connect();
  const settings = await db.connect();
  try {
    await mover.query("BEGIN");
    await mover.query("SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE", [id]);
    const start = startTask(agent, id);
    await pause(300);
    await mover.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [target.projectId, id]);
    // A status edit on the target holds its settings, as updateProject does,
    // and then rewrites the moved task. FOR NO KEY UPDATE conflicts with the
    // start's FOR SHARE like updateProject's FOR UPDATE, but not with the key
    // the move's uncommitted task_keys row holds on the same settings row.
    await settings.query("BEGIN");
    await settings.query("SELECT 1 FROM dev_projects WHERE project_id = $1 FOR NO KEY UPDATE", [target.projectId]);
    await mover.query("COMMIT");
    await pause(300);
    await settings.query("UPDATE tasks SET status = 'レビュー' WHERE id = $1", [id]);
    await settings.query("COMMIT");
    const started = await start;
    assert.deepEqual(started.changed, { assignee: true, status: false, reopened: false });
  } finally {
    mover.release();
    settings.release();
  }
  const row = await taskRow(id);
  assert.equal(row.assignee_id, agent.uid);
  assert.equal(row.status, "レビュー");
});

test("many stale-stamp starts at once do not exhaust the connection pool", async () => {
  const agent = await user("Pool agent");
  const dev = await devProject("Pool project", [[agent, "editor"]]);
  const ids = [];
  for (let index = 0; index < 16; index++) ids.push(await task(dev.projectId, `pool ${index}`));
  // Hold every task so each start fills a pool connection with an open
  // transaction before any of them reaches the conflict.
  const holder = await db.connect();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("starts did not finish: pool exhausted")), 10_000);
  });
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM tasks WHERE id = ANY($1::bigint[]) FOR UPDATE", [ids]);
    const starts = Promise.all(
      ids.map((id) => failure(startTask(agent, id, { expectedUpdatedAt: "2000-01-01 00:00:00+00" }))),
    );
    await pause(500);
    await holder.query("COMMIT");
    const results = await Promise.race([starts, timeout]);
    assert.ok(results.every((result) => result.reason === "conflict"));
  } finally {
    clearTimeout(timer);
    holder.release();
  }
});
