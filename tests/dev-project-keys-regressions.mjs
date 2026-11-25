// Database-level regressions for development-project issue keys
// (docs/dev-projects-phase0.md §4, §10). Needs only PostgreSQL with
// db/init.sql and the migrations applied; DATABASE_URL points at it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
// A lock wait that never resolves (for example a deadlock between a session
// and this test's own idle transaction) fails fast instead of hanging.
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  options: "-c lock_timeout=5s",
});
after(() => db.end());

const MAX_TASKS = 20_000;

function uniquePrefix() {
  // 2–10 chars, starts with a letter. Unique per test run.
  return `T${randomBytes(4).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 10);
}

async function project(name) {
  const { rows: [row] } = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES (1, $1) RETURNING id",
    [name],
  );
  return Number(row.id);
}

async function task(projectId, name, extra = {}) {
  const { rows: [row] } = await db.query(
    `INSERT INTO tasks (project_id, name, parent_task_id, created_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now())) RETURNING id`,
    [projectId, name, extra.parent ?? null, extra.createdAt ?? null],
  );
  return Number(row.id);
}

async function enable(projectId, prefix, { startStatus = null, client = db, maxTasks = MAX_TASKS } = {}) {
  const { rows: [row] } = await client.query(
    "SELECT namespace_id, keyed FROM atlas_enable_dev_project($1, $2, $3, NULL, $4)",
    [projectId, prefix, startStatus, maxTasks],
  );
  return { namespaceId: Number(row.namespace_id), keyed: Number(row.keyed) };
}

async function keyOf(taskId) {
  const { rows: [row] } = await db.query(
    `SELECT p.prefix || '-' || k.number AS key, k.namespace_id, k.number
       FROM task_keys k JOIN dev_projects p ON p.id = k.namespace_id
      WHERE k.task_id = $1`,
    [taskId],
  );
  return row ? { key: row.key, namespaceId: Number(row.namespace_id), number: Number(row.number) } : null;
}

/** Tasks whose primary project is a development project but that have no key (§4.3). */
async function invariantViolations() {
  const { rows } = await db.query(
    `SELECT t.id FROM tasks t JOIN dev_projects d ON d.project_id = t.project_id
      WHERE NOT EXISTS (SELECT 1 FROM task_keys k WHERE k.task_id = t.id)`,
  );
  return rows.map((row) => Number(row.id));
}

/** Wait until `count` backends in this database are blocked on a lock. */
async function waitForLockWaiters(count, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  let waiting = 0;
  while (Date.now() < deadline) {
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    waiting = n;
    if (waiting >= count) return;
    await delay(20);
  }
  assert.fail(`expected ${count} lock waiter(s), saw ${waiting}`);
}

async function withClient(fn) {
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

test("new tasks in a development project get sequential keys; other projects get none", { timeout: 15_000 }, async () => {
  const dev = await project("Keys dev");
  const plain = await project("Keys plain");
  const prefix = uniquePrefix();
  await enable(dev, prefix);
  const first = await task(dev, "first");
  const second = await task(dev, "second");
  const child = await task(dev, "child", { parent: first });
  const other = await task(plain, "other");
  assert.equal((await keyOf(first)).key, `${prefix}-1`);
  assert.equal((await keyOf(second)).key, `${prefix}-2`);
  assert.equal((await keyOf(child)).key, `${prefix}-3`, "subtasks are keyed too");
  assert.equal(await keyOf(other), null);
});

test("enabling keys existing tasks, including trashed ones, in creation order", { timeout: 15_000 }, async () => {
  const dev = await project("Backfill");
  const later = await task(dev, "later", { createdAt: "2026-02-01T00:00:00Z" });
  const earlier = await task(dev, "earlier", { createdAt: "2026-01-01T00:00:00Z" });
  const trashed = await task(dev, "trashed", { createdAt: "2026-03-01T00:00:00Z" });
  await db.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [trashed]);
  const prefix = uniquePrefix();
  const { keyed } = await enable(dev, prefix);
  assert.equal(keyed, 3);
  assert.equal((await keyOf(earlier)).number, 1);
  assert.equal((await keyOf(later)).number, 2);
  assert.equal((await keyOf(trashed)).number, 3);
  const next = await task(dev, "next");
  assert.equal((await keyOf(next)).number, 4, "numbering continues after the backfill");
  await db.query("UPDATE tasks SET deleted_at = NULL WHERE id = $1", [trashed]);
  assert.equal((await keyOf(trashed)).number, 3, "restoring from trash keeps the key");
});

test("moves: into a development project keys the task; keyed tasks keep their original key", { timeout: 15_000 }, async () => {
  const a = await project("Move A");
  const b = await project("Move B");
  const plain = await project("Move plain");
  const prefixA = uniquePrefix();
  const prefixB = uniquePrefix();
  await enable(a, prefixA);
  await enable(b, prefixB);

  const outsider = await task(plain, "outsider");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [a, outsider]);
  assert.equal((await keyOf(outsider)).key, `${prefixA}-1`, "moved in from a plain project");

  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [b, outsider]);
  assert.equal((await keyOf(outsider)).key, `${prefixA}-1`, "A to B keeps A's key");

  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [plain, outsider]);
  assert.equal((await keyOf(outsider)).key, `${prefixA}-1`, "B to a plain project keeps the key");

  const inB = await task(b, "native to B");
  assert.equal((await keyOf(inB)).key, `${prefixB}-1`, "B's counter was not consumed by the moved task");
});

test("enabling a project leaves keys that tasks brought from another development project", { timeout: 15_000 }, async () => {
  const a = await project("Bring A");
  const b = await project("Bring B");
  const prefixA = uniquePrefix();
  await enable(a, prefixA);
  const traveller = await task(a, "traveller");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [b, traveller]);
  const native = await task(b, "native");
  const { keyed } = await enable(b, uniquePrefix());
  assert.equal(keyed, 1);
  assert.equal((await keyOf(traveller)).key, `${prefixA}-1`);
  assert.equal((await keyOf(native)).number, 1);
});

test("50 concurrent inserts into one development project get distinct, gapless numbers", { timeout: 15_000 }, async () => {
  const dev = await project("Concurrent");
  await enable(dev, uniquePrefix());
  const ids = await Promise.all(Array.from({ length: 50 }, (_, i) => task(dev, `parallel ${i}`)));
  const numbers = (await Promise.all(ids.map(keyOf))).map((k) => k.number).sort((x, y) => x - y);
  assert.deepEqual(numbers, Array.from({ length: 50 }, (_, i) => i + 1));
});

test("an insert in flight when enabling starts is keyed by the backfill", { timeout: 15_000 }, async () => {
  const dev = await project("Insert first");
  const prefix = uniquePrefix();
  await withClient(async (inserter) => {
    await inserter.query("BEGIN");
    const { rows: [row] } = await inserter.query(
      "INSERT INTO tasks (project_id, name) VALUES ($1, 'in flight') RETURNING id", [dev],
    );
    const enabling = enable(dev, prefix);
    await waitForLockWaiters(1);
    await inserter.query("COMMIT");
    const { keyed } = await enabling;
    assert.equal(keyed, 1);
    assert.equal((await keyOf(Number(row.id))).key, `${prefix}-1`);
  });
});

test("an insert that starts while enabling is in progress waits and is keyed by the trigger", { timeout: 15_000 }, async () => {
  const dev = await project("Enable first");
  const before = await task(dev, "before");
  const prefix = uniquePrefix();
  await withClient(async (enabler) => {
    await enabler.query("BEGIN");
    await enable(dev, prefix, { client: enabler });
    const inserting = task(dev, "during");
    await waitForLockWaiters(1);
    await enabler.query("COMMIT");
    const during = await inserting;
    assert.equal((await keyOf(before)).key, `${prefix}-1`);
    assert.equal((await keyOf(during)).key, `${prefix}-2`);
  });
});

test("enabling does not deadlock with a duplicate that locked its source row first", { timeout: 15_000 }, async () => {
  // duplicateTask: SELECT source FOR SHARE, then INSERT into the same project.
  const dev = await project("Duplicate race");
  const source = await task(dev, "source");
  const prefix = uniquePrefix();
  await withClient(async (duplicator) => withClient(async (enabler) => {
    await duplicator.query("BEGIN");
    await duplicator.query("SELECT id FROM tasks WHERE id = $1 FOR SHARE", [source]);
    await enabler.query("BEGIN");
    // Holds the project row; must not wait on the source row.
    await enable(dev, prefix, { client: enabler });
    const inserting = duplicator.query(
      "INSERT INTO tasks (project_id, name) VALUES ($1, 'copy') RETURNING id", [dev],
    );
    await waitForLockWaiters(1);
    await enabler.query("COMMIT");
    const { rows: [copy] } = await inserting;
    await duplicator.query("COMMIT");
    assert.equal((await keyOf(source)).key, `${prefix}-1`);
    assert.equal((await keyOf(Number(copy.id))).key, `${prefix}-2`);
  }));
});

test("enabling fails fast instead of deadlocking with a recurring completion that locked its task", { timeout: 15_000 }, async () => {
  // task-update: SELECT task FOR UPDATE, then insertNextOccurrence INSERTs
  // into the same project. Waiting on the task row while holding the project
  // row would deadlock, so enabling reports 55P03 and the caller retries.
  const dev = await project("Completion race");
  const source = await task(dev, "recurring");
  const prefix = uniquePrefix();
  await withClient(async (completer) => withClient(async (enabler) => {
    await completer.query("BEGIN");
    await completer.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [source]);
    await enabler.query("BEGIN");
    const started = Date.now();
    await assert.rejects(enable(dev, prefix, { client: enabler }), { code: "55P03" });
    assert.ok(Date.now() - started < 1_000, "enabling must not wait on the task row");
    await enabler.query("ROLLBACK");

    const { rows: [next] } = await completer.query(
      "INSERT INTO tasks (project_id, name) VALUES ($1, 'next occurrence') RETURNING id", [dev],
    );
    await completer.query("COMMIT");

    await enable(dev, prefix);
    assert.equal((await keyOf(source)).key, `${prefix}-1`);
    assert.equal((await keyOf(Number(next.id))).key, `${prefix}-2`);
  }));
});

test("a completion that starts after enabling locked the tasks waits and is keyed", { timeout: 15_000 }, async () => {
  const dev = await project("Completion after enable");
  const source = await task(dev, "recurring");
  const prefix = uniquePrefix();
  await withClient(async (completer) => withClient(async (enabler) => {
    await enabler.query("BEGIN");
    await enable(dev, prefix, { client: enabler });
    await completer.query("BEGIN");
    const locking = completer.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [source]);
    await waitForLockWaiters(1);
    await enabler.query("COMMIT");
    await locking;
    const { rows: [next] } = await completer.query(
      "INSERT INTO tasks (project_id, name) VALUES ($1, 'next occurrence') RETURNING id", [dev],
    );
    await completer.query("COMMIT");
    assert.equal((await keyOf(source)).key, `${prefix}-1`);
    assert.equal((await keyOf(Number(next.id))).key, `${prefix}-2`);
  }));
});

test("a locked task that already has a key does not block enabling", { timeout: 15_000 }, async () => {
  const origin = await project("Keyed origin");
  const originPrefix = uniquePrefix();
  await enable(origin, originPrefix);
  const moved = await task(origin, "moved");
  const target = await project("Keyed target");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [target, moved]);
  await withClient(async (locker) => {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [moved]);
    const { keyed } = await enable(target, uniquePrefix());
    assert.equal(keyed, 0);
    await locker.query("COMMIT");
  });
  assert.equal((await keyOf(moved)).key, `${originPrefix}-1`);
});

test("enabling races a move out of the project without duplicate or lost keys", { timeout: 15_000 }, async () => {
  const a = await project("Race A");
  const b = await project("Race B");
  const prefixA = uniquePrefix();
  const prefixB = uniquePrefix();
  await enable(b, prefixB);
  const mover = await task(a, "mover");
  await withClient(async (moving) => withClient(async (enabler) => {
    await moving.query("BEGIN");
    await moving.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [b, mover]);
    await enabler.query("BEGIN");
    // The move is uncommitted, so the backfill still sees the task in A.
    const enabling = enable(a, prefixA, { client: enabler });
    await moving.query("COMMIT");
    await enabling;
    await enabler.query("COMMIT");
  }));
  const key = await keyOf(mover);
  assert.ok(key, "the task has a key");
  assert.ok([`${prefixA}-1`, `${prefixB}-1`].includes(key.key), key.key);
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM task_keys WHERE task_id = $1", [mover]);
  assert.equal(n, 1);
});

test("a move into another development project during an uncommitted enable keeps the enable's key", { timeout: 15_000 }, async () => {
  const a = await project("Race2 A");
  const b = await project("Race2 B");
  const prefixA = uniquePrefix();
  await enable(b, uniquePrefix());
  const mover = await task(a, "mover");
  await withClient(async (enabler) => withClient(async (moving) => {
    await enabler.query("BEGIN");
    await enable(a, prefixA, { client: enabler });   // keyed mover in A, uncommitted
    await moving.query("BEGIN");
    // The trigger's insert conflicts with the enable's uncommitted key and waits.
    const moved = moving.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [b, mover]);
    await waitForLockWaiters(1);
    await enabler.query("COMMIT");
    await moved;
    await moving.query("COMMIT");
  }));
  assert.equal((await keyOf(mover)).key, `${prefixA}-1`);
});

test("prefixes are unique per workspace and enabling twice is refused", { timeout: 15_000 }, async () => {
  const a = await project("Prefix A");
  const b = await project("Prefix B");
  const prefix = uniquePrefix();
  await enable(a, prefix);
  await assert.rejects(enable(b, prefix), { code: "23505" });
  await assert.rejects(enable(a, uniquePrefix()), { code: "DK409" });
  await assert.rejects(enable(b, "lower"), { code: "23514" }, "the table rejects non-normalized prefixes");
});

test("enable validates start_status, the task limit and trashed projects", { timeout: 15_000 }, async () => {
  const dev = await project("Validate");
  await assert.rejects(enable(dev, uniquePrefix(), { startStatus: "存在しない" }), { code: "DK422" });
  await task(dev, "one");
  await task(dev, "two");
  await assert.rejects(enable(dev, uniquePrefix(), { maxTasks: 1 }), { code: "DK413" });
  const { namespaceId } = await enable(dev, uniquePrefix(), { startStatus: "進行中" });
  const { rows: [row] } = await db.query("SELECT start_status FROM dev_projects WHERE id = $1", [namespaceId]);
  assert.equal(row.start_status, "進行中");
  const trashed = await project("Trashed");
  await db.query("UPDATE projects SET deleted_at = now() WHERE id = $1", [trashed]);
  await assert.rejects(enable(trashed, uniquePrefix()), { code: "DK404" });
});

test("hard-deleting a development project keeps keys of tasks moved elsewhere", { timeout: 15_000 }, async () => {
  const dev = await project("Doomed");
  const keep = await project("Keeper");
  const prefix = uniquePrefix();
  const { namespaceId } = await enable(dev, prefix);
  const moved = await task(dev, "moved away");
  await db.query("UPDATE tasks SET project_id = $1 WHERE id = $2", [keep, moved]);
  await db.query("DELETE FROM projects WHERE id = $1", [dev]);
  const { rows: [ns] } = await db.query("SELECT project_id FROM dev_projects WHERE id = $1", [namespaceId]);
  assert.equal(ns.project_id, null);
  assert.equal((await keyOf(moved)).key, `${prefix}-1`);
});

test("invariant: every task in a development project has a key", { timeout: 15_000 }, async () => {
  assert.deepEqual(await invariantViolations(), []);
});
