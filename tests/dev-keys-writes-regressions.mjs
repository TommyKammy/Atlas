// MCP creation idempotency and write-tool key support against PostgreSQL
// (docs/dev-projects-phase0.md §7, §8, §10). Run with `node --import tsx`;
// DATABASE_URL points at a database with init.sql and the migrations applied.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, mock, test } from "node:test";
import pg from "pg";

// The services run their production SQL; only Next's request marker is
// unavailable outside a request handler. Live notifications are best effort;
// without a Redis client they are skipped, and no reconnecting socket keeps
// the test process alive.
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
const { db: appDb } = await import("../lib/db.ts");
const { createWriteTools, DEFAULT_MCP_WRITE_SERVICES } = await import("../lib/mcp/server.ts");
const { withIdempotency } = await import("../lib/mcp/idempotency.ts");
const { createTask } = await import("../lib/services/task-create.ts");

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
after(() => db.end());

// Each test installs its own failure injection; undo it afterwards.
const injections = [];
afterEach(() => {
  while (injections.length > 0) injections.pop().mock.restore();
});

/** Fail the first app query whose SQL contains `fragment`, once. */
function failOnce(fragment, message) {
  const original = appDb.query;
  let failed = false;
  const injected = mock.method(appDb, "query", async (sql, params) => {
    if (!failed && String(sql).includes(fragment)) {
      failed = true;
      throw new Error(message);
    }
    return original.call(appDb, sql, params);
  });
  injections.push(injected);
}

function uniquePrefix() {
  return `W${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 10);
}

function uniqueKey() {
  return `idem-${randomBytes(6).toString("hex")}`;
}

async function user(name) {
  const { rows: [row] } = await db.query("INSERT INTO users (name) VALUES ($1) RETURNING id", [name]);
  const uid = Number(row.id);
  const { rows: [token] } = await db.query(
    `INSERT INTO mcp_tokens (workspace_id, user_id, kind, name, token_hash, scopes)
     VALUES (1, $1, 'pat', 'test', $2, ARRAY['read', 'write']) RETURNING id`,
    [uid, randomBytes(32).toString("hex")],
  );
  return { uid, source: "mcp", tokenId: Number(token.id) };
}

async function project(name, members = []) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES (1, $1) RETURNING id", [name],
  );
  for (const [member, role] of members) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)",
      [row.id, member.uid, role],
    );
  }
  return Number(row.id);
}

async function enable(projectId, prefix) {
  await db.query("SELECT atlas_enable_dev_project($1, $2, NULL, NULL, 20000)", [projectId, prefix]);
}

function context(actor) {
  return { actor, scopes: ["read", "write"], endpoint: "default", era: "modern" };
}

function toolSet(services = DEFAULT_MCP_WRITE_SERVICES) {
  return Object.fromEntries(createWriteTools(services).map((tool) => [tool.name, tool]));
}

async function countTasks(name) {
  const { rows: [row] } = await db.query("SELECT count(*)::int AS n FROM tasks WHERE name = $1", [name]);
  return row.n;
}

async function reservation(actor, key) {
  const { rows: [row] } = await db.query(
    `SELECT created_task_id, response, owner_token FROM mcp_idempotency
      WHERE token_id = $1 AND idempotency_key = $2`,
    [actor.tokenId, key],
  );
  return row;
}

async function makeStale(actor, key) {
  await db.query(
    `UPDATE mcp_idempotency SET created_at = now() - interval '10 minutes'
      WHERE token_id = $1 AND idempotency_key = $2`,
    [actor.tokenId, key],
  );
}

test("a crash between the commit and the response write still creates one task", async () => {
  const agent = await user("Crash agent");
  const projectId = await project("Crash project", [[agent, "editor"]]);
  const tools = toolSet();
  const key = uniqueKey();
  const name = `crash-${key}`;
  const args = { project_id: projectId, name, idempotency_key: key };

  failOnce("UPDATE mcp_idempotency SET response", "process died");
  await assert.rejects(tools.save_task.handler(args, context(agent)), /process died/);
  const stored = await reservation(agent, key);
  assert.ok(stored.created_task_id, "the reservation names the created task");
  assert.equal(stored.response, null);

  // Before the stale window the first execution may still be finishing.
  await assert.rejects(
    tools.save_task.handler(args, context(agent)),
    (error) => error.status === 409 && error.message === "idempotency key is already in progress",
  );

  await makeStale(agent, key);
  const recovered = await tools.save_task.handler(args, context(agent));
  assert.equal(recovered.isError, undefined);
  assert.equal(recovered.structuredContent.recovered, true);
  assert.equal(recovered.structuredContent.task.id, Number(stored.created_task_id));
  assert.equal(await countTasks(name), 1);
  // Recovery only reads: the reservation is left as it was.
  assert.equal((await reservation(agent, key)).response, null);
});

test("a failure after the commit inside createTask keeps the reservation and recovers the task", async () => {
  // afterTaskCreated swallows its own failures today, so the stamp read that
  // follows it stands in for any error raised after the INSERT committed.
  const agent = await user("After-commit agent");
  const projectId = await project("After-commit project", [[agent, "editor"]]);
  const tools = toolSet();
  const key = uniqueKey();
  const name = `after-commit-${key}`;
  const args = { project_id: projectId, name, idempotency_key: key };

  failOnce("SELECT updated_at::text AS updated_at FROM tasks WHERE id", "read failed after commit");
  await assert.rejects(tools.save_task.handler(args, context(agent)), /read failed after commit/);
  assert.ok((await reservation(agent, key)).created_task_id);

  await makeStale(agent, key);
  const recovered = await tools.save_task.handler(args, context(agent));
  assert.equal(recovered.structuredContent.recovered, true);
  assert.equal(await countTasks(name), 1);
});

test("recovery reports a person's later edit as not_confirmed and keeps it", async () => {
  const agent = await user("Edit agent");
  const projectId = await project("Edit project", [[agent, "editor"]]);
  const tools = toolSet();
  const key = uniqueKey();
  const name = `edit-${key}`;
  const args = { project_id: projectId, name, description: "Written by the agent", idempotency_key: key };

  failOnce("UPDATE mcp_idempotency SET response", "process died");
  await assert.rejects(tools.save_task.handler(args, context(agent)), /process died/);
  const { created_task_id: taskId } = await reservation(agent, key);
  await db.query("UPDATE tasks SET description = 'Fixed by a person' WHERE id = $1", [taskId]);

  await makeStale(agent, key);
  const recovered = await tools.save_task.handler(args, context(agent));
  assert.equal(recovered.isError, true);
  assert.equal(recovered.structuredContent.recovered, true);
  assert.deepEqual(recovered.structuredContent.failed_updates, [
    { field: "description", error: "not_confirmed" },
  ]);
  const { rows: [task] } = await db.query("SELECT description FROM tasks WHERE id = $1", [taskId]);
  assert.equal(task.description, "Fixed by a person");
});

test("a reservation taken over before the insert rolls the creation back", async () => {
  const agent = await user("Takeover agent");
  const projectId = await project("Takeover project", [[agent, "editor"]]);
  const key = uniqueKey();
  const name = `takeover-${key}`;
  const tools = toolSet({
    ...DEFAULT_MCP_WRITE_SERVICES,
    createTask: async (actor, input, options) => {
      // Another execution takes the reservation over while this one runs.
      await db.query(
        "UPDATE mcp_idempotency SET owner_token = 'other' WHERE token_id = $1 AND idempotency_key = $2",
        [actor.tokenId, key],
      );
      return createTask(actor, input, options);
    },
  });

  await assert.rejects(
    tools.save_task.handler({ project_id: projectId, name, idempotency_key: key }, context(agent)),
    (error) => error.status === 409 && error.message === "idempotency key was taken over by another request",
  );
  assert.equal(await countTasks(name), 0);
  const stored = await reservation(agent, key);
  assert.equal(stored.owner_token, "other");
  assert.equal(stored.created_task_id, null);
});

test("a stale takeover racing the creation waits for it and recovers instead", async () => {
  const agent = await user("Race agent");
  const projectId = await project("Race project", [[agent, "editor"]]);
  const key = uniqueKey();
  const name = `race-${key}`;
  const args = { project_id: projectId, name, idempotency_key: key };
  let racing;
  const tools = toolSet({
    ...DEFAULT_MCP_WRITE_SERVICES,
    createTask: (actor, input, options) => createTask(actor, input, {
      onInserted: async (q, taskId) => {
        // The reservation looks abandoned to a retry that starts now.
        await makeStale(agent, key);
        await options.onInserted(q, taskId);
        // The retry's takeover blocks on the row this transaction updated.
        racing = withIdempotency(
          { tokenId: agent.tokenId, toolName: "save_task", key, args },
          async () => assert.fail("the retry must not create a second task"),
          { recover: async ({ createdTaskId }) => ({ recoveredId: createdTaskId }) },
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    }),
  });

  const created = await tools.save_task.handler(args, context(agent));
  const createdId = created.structuredContent.task.id;
  assert.deepEqual(await racing, { recoveredId: createdId });
  assert.equal(await countTasks(name), 1);
});

test("a prefix and the numeric project id are the same request", async () => {
  const agent = await user("Prefix agent");
  const projectId = await project("Prefix project", [[agent, "editor"]]);
  const prefix = uniquePrefix();
  await enable(projectId, prefix);
  const tools = toolSet();
  const key = uniqueKey();
  const name = `prefix-${key}`;

  const first = await tools.save_task.handler(
    { project_id: prefix.toLowerCase(), name, idempotency_key: key }, context(agent),
  );
  const second = await tools.save_task.handler(
    { project_id: projectId, name, idempotency_key: key }, context(agent),
  );
  assert.deepEqual(second.structuredContent, first.structuredContent);
  assert.equal(first.structuredContent.task.key, `${prefix}-1`);
  assert.equal(await countTasks(name), 1);

  const commentKey = uniqueKey();
  const byKey = await tools.add_comment.handler(
    { task_id: `${prefix}-1`, body: "PR opened", idempotency_key: commentKey }, context(agent),
  );
  const byId = await tools.add_comment.handler(
    { task_id: first.structuredContent.task.id, body: "PR opened", idempotency_key: commentKey }, context(agent),
  );
  assert.deepEqual(byId.structuredContent, byKey.structuredContent);
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM comments WHERE task_id = $1", [first.structuredContent.task.id],
  );
  assert.equal(n, 1);
});

test("write tools act on keys for editors, hide them from outsiders and keep 403 for viewers", async () => {
  const editor = await user("Keyed editor");
  const viewer = await user("Keyed viewer");
  const outsider = await user("Keyed outsider");
  const projectId = await project("Keyed project", [[editor, "editor"], [viewer, "viewer"]]);
  const prefix = uniquePrefix();
  await enable(projectId, prefix);
  const tools = toolSet();
  const parent = await tools.save_task.handler({ project_id: prefix, name: "parent" }, context(editor));
  const child = await tools.save_task.handler(
    { project_id: prefix, parent_task_id: `${prefix}-1`, name: "child" }, context(editor),
  );
  assert.equal(child.structuredContent.task.key, `${prefix}-2`);
  assert.equal(child.structuredContent.parent.id, parent.structuredContent.task.id);

  const done = await tools.complete_task.handler({ id: `${prefix.toLowerCase()}-2` }, context(editor));
  assert.equal(done.structuredContent.task.completed, true);
  assert.match(done.content[0].text, new RegExp(`^Task ${prefix}-2 \\(id \\d+\\) marked complete`));
  const renamed = await tools.save_task.handler({ id: `${prefix}-2`, name: "child renamed" }, context(editor));
  assert.equal(renamed.structuredContent.task.name, "child renamed");

  await assert.rejects(
    tools.complete_task.handler({ id: `${prefix}-2` }, context(outsider)),
    (error) => error.status === 404 && error.message === "task not found",
  );
  await assert.rejects(
    tools.save_task.handler({ project_id: prefix, name: "nope" }, context(outsider)),
    (error) => error.status === 404 && error.message === "project not found",
  );
  // A viewer may know the task exists, so the write service's 403 stands.
  await assert.rejects(
    tools.complete_task.handler({ id: `${prefix}-2`, completed: false }, context(viewer)),
    (error) => error.status === 403,
  );

  const trashed = await tools.trash_task.handler({ id: `${prefix}-2` }, context(editor));
  assert.deepEqual(trashed.structuredContent, { id: child.structuredContent.task.id, trashed: true });
});
