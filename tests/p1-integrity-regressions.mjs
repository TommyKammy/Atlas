import assert from "node:assert/strict";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function raceWrites(table, start) {
  const locker = await db.connect();
  let operations;
  try {
    await locker.query("BEGIN");
    // Plain reads can still finish. Keep both mutations pending before release.
    await locker.query(`LOCK TABLE ${table} IN SHARE MODE`);
    operations = Promise.all(start());
    void operations.catch(() => undefined);
    const deadline = Date.now() + 3_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const { rows: [{ n }] } = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      waiting = n;
      if (waiting >= 2) break;
      await delay(25);
    }
    assert.ok(waiting >= 2, `Both writes must reach a database lock on ${table}`);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
  return operations;
}

function write(cookie, method, path, json) {
  return http(path, { cookie, method, json, timeout: 9_000 });
}

function statuses(responses) {
  return responses.map(({ status }) => status).sort((a, b) => a - b);
}

test("R11 simultaneous opposite dependency edges cannot create a cycle", { timeout: 15_000 }, async () => {
  const { a, editor } = await fixtures("Dependency cycle");
  const left = await task(a, "Left");
  const right = await task(a, "Right");
  const add = (from, to) => write(editor, "POST", "/api/dependencies", { task_id: from, depends_on_id: to });
  const result = await raceWrites("task_dependencies", () => [add(left, right), add(right, left)]);
  assert.deepEqual(statuses(result), [201, 409]);
  const { rowCount } = await db.query(
    "SELECT 1 FROM task_dependencies WHERE task_id = ANY($1::bigint[]) AND depends_on_id = ANY($1::bigint[])",
    [[left, right]],
  );
  assert.equal(rowCount, 1);
});

test("R11 simultaneous reciprocal reparenting cannot create a cycle", { timeout: 15_000 }, async () => {
  const { a, editor } = await fixtures("Parent cycle");
  const left = await task(a, "First parent");
  const right = await task(a, "Second parent");
  const reparent = (child, parent) => write(editor, "PATCH", `/api/tasks/${child}`, { parent_task_id: parent });
  const result = await raceWrites("tasks", () => [reparent(left, right), reparent(right, left)]);
  assert.deepEqual(statuses(result), [200, 400]);
  const { rowCount } = await db.query(
    "SELECT 1 FROM tasks WHERE id = ANY($1::bigint[]) AND parent_task_id = ANY($1::bigint[])", [[left, right]],
  );
  assert.equal(rowCount, 1);
});

async function recurring(projectId, name) {
  const id = await task(projectId, name);
  await db.query("UPDATE tasks SET recurrence = 'daily', due_on = '2026-11-09' WHERE id = $1", [id]);
  return id;
}

test("R12 concurrent completion creates one successor and one completion event", { timeout: 15_000 }, async () => {
  const { a, editor } = await fixtures("Completion");
  const name = "Recurring concurrent completion";
  const id = await recurring(a, name);
  const path = `/api/tasks/${id}`;
  const complete = () => write(editor, "PATCH", path, { completed: true });
  const result = await raceWrites("tasks", () => [complete(), complete()]);
  assert.deepEqual(statuses(result), [200, 200]);

  const { rows } = await db.query(
    "SELECT id, completed, due_on::text FROM tasks WHERE project_id = $1 AND name = $2 ORDER BY id", [a, name],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].completed, true);
  assert.equal(rows[1].completed, false);
  assert.equal(rows[1].due_on, "2026-11-10");
  const { rows: events } = await db.query(
    `SELECT type, subject_id FROM domain_events WHERE project_id = $1
     AND subject_id = ANY($2::bigint[]) AND type IN ('task.completed', 'task.created') ORDER BY id`,
    [a, [id, rows[1].id]],
  );
  assert.deepEqual(events.map(({ type, subject_id }) => [type, String(subject_id)]).sort(), [
    ["task.completed", String(id)], ["task.created", rows[1].id],
  ]);

  const bulk = { ids: [id], op: "complete" };
  assert.equal((await request(editor, "POST", "/api/tasks/bulk", 200, bulk)).updated, 0);
  await request(editor, "PATCH", path, 200, { completed: false });
  assert.equal((await request(editor, "POST", "/api/tasks/bulk", 200, bulk)).updated, 1);
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = $2", [a, name])).rowCount, 2);
});

test("R12 an outbox write failure rolls back completion and recurrence", { timeout: 12_000 }, async (t) => {
  const { a, editor } = await fixtures("Completion rollback");
  const name = "Recurring completion rollback";
  const id = await recurring(a, name);
  await db.query(`ALTER TABLE domain_events ADD CONSTRAINT regression_block_successor_event
                  CHECK (type <> 'task.created' OR data->'recurrence' IS DISTINCT FROM 'true'::jsonb) NOT VALID`);
  t.after(() => db.query("ALTER TABLE domain_events DROP CONSTRAINT IF EXISTS regression_block_successor_event"));

  assert.equal((await write(editor, "PATCH", `/api/tasks/${id}`, { completed: true })).status, 500);
  assert.equal((await write(editor, "POST", "/api/tasks/bulk", { ids: [id], op: "complete" })).status, 500);
  const { rows } = await db.query(
    "SELECT completed, completed_at FROM tasks WHERE project_id = $1 AND name = $2", [a, name],
  );
  assert.deepEqual(rows, [{ completed: false, completed_at: null }]);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1", [a])).rowCount, 0);
});

test("R13 concurrent first pins, moves and unpins honor the expected timeline version", { timeout: 20_000 }, async () => {
  const { a, editor } = await fixtures("Timeline row CAS");
  const id = await task(a, "Concurrent timeline row");
  const path = `/api/tasks/${id}/timeline-row`;
  const pin = (row, expected) => write(editor, "PUT", path, {
    project_id: a, row_index: row, expected_updated_at: expected,
  });
  async function versionOfWinner(responses) {
    assert.deepEqual(statuses(responses), [200, 409]);
    const changed = await responses.find(({ status }) => status === 200).json();
    const rejected = await responses.find(({ status }) => status === 409).json();
    assert.equal(rejected.updated_at, changed.updated_at);
    return changed;
  }

  const first = await versionOfWinner(await raceWrites("task_timeline_rows", () => [pin(1, null), pin(2, null)]));
  assert.match(first.updated_at, /\d/);
  const moved = await versionOfWinner(await raceWrites("task_timeline_rows", () => [
    pin(3, first.updated_at), pin(4, first.updated_at),
  ]));
  assert.notEqual(moved.updated_at, first.updated_at);
  const last = await versionOfWinner(await raceWrites("task_timeline_rows", () => [
    pin(5, moved.updated_at), pin(null, moved.updated_at),
  ]));
  if (last.updated_at !== null) assert.equal((await pin(null, last.updated_at)).status, 200);
  assert.equal((await pin(6, moved.updated_at)).status, 409);
  assert.equal((await db.query("SELECT 1 FROM task_timeline_rows WHERE task_id = $1", [id])).rowCount, 0);
});

test("R15 status chains and swaps use each task's original value", { timeout: 12_000 }, async () => {
  const { a, b, owner } = await fixtures("Status mapping");
  const { rows: [{ id: first }, { id: second }, { id: other }] } = await db.query(
    "INSERT INTO tasks (project_id, name, status) VALUES ($1, 'First', 'A'), ($1, 'Second', 'B'), ($2, 'Other', 'A') RETURNING id",
    [a, b],
  );
  let version = 0;
  async function rename(options, mappings) {
    await request(owner, "PATCH", `/api/projects/${a}`, 200, {
      status_options: options, status_renames: mappings.map(([from, to]) => ({ from, to })),
      expected_status_options_version: version++,
    });
    const { rows } = await db.query("SELECT status FROM tasks WHERE id = ANY($1::bigint[]) ORDER BY id", [[first, second, other]]);
    return rows.map(({ status }) => status);
  }
  assert.deepEqual(await rename(["B", "C"], [["A", "B"], ["B", "C"]]), ["B", "C", "A"]);
  assert.deepEqual(await rename(["C", "B"], [["B", "C"], ["C", "B"]]), ["C", "B", "A"]);
  assert.deepEqual(await rename(["Merged"], [["B", "Merged"], ["C", "Merged"]]), ["Merged", "Merged", "A"]);
});

test("R15 stale and replayed status renames cannot rewrite a committed swap", { timeout: 12_000 }, async () => {
  const { a, owner } = await fixtures("Status version");
  await db.query("UPDATE projects SET status_options = '[\"A\",\"B\"]'::jsonb WHERE id = $1", [a]);
  await db.query("INSERT INTO tasks (project_id, name, status) VALUES ($1, 'First', 'A'), ($1, 'Second', 'B')", [a]);
  const path = `/api/projects/${a}`;
  const swap = {
    status_options: ["A", "B"],
    status_renames: [{ from: "A", to: "B" }, { from: "B", to: "A" }],
  };
  const body = { ...swap, expected_status_options_version: 0 };
  const responses = await raceWrites("projects", () => [
    write(owner, "PATCH", path, body), write(owner, "PATCH", path, body),
  ]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
  await request(owner, "PATCH", path, 400, swap);
  const conflict = await request(owner, "PATCH", path, 409, body);
  assert.deepEqual(conflict.status_options, ["A", "B"]);
  assert.equal(conflict.status_options_version, 1);
  const { rows } = await db.query("SELECT status FROM tasks WHERE project_id = $1 ORDER BY id", [a]);
  assert.deepEqual(rows.map(({ status }) => status), ["B", "A"]);
});

test("R15 task rewrite failure rolls back status options and other task changes", { timeout: 12_000 }, async (t) => {
  const { a, owner } = await fixtures("Status rollback");
  await db.query("UPDATE projects SET status_options = '[\"A\",\"B\"]'::jsonb WHERE id = $1", [a]);
  await db.query("INSERT INTO tasks (project_id, name, status) VALUES ($1, 'First', 'A'), ($1, 'Second', 'B')", [a]);
  await db.query(`ALTER TABLE tasks ADD CONSTRAINT regression_block_status CHECK (status <> 'Blocked') NOT VALID`);
  t.after(() => db.query("ALTER TABLE tasks DROP CONSTRAINT IF EXISTS regression_block_status"));
  assert.equal((await write(owner, "PATCH", `/api/projects/${a}`, {
    status_options: ["Moved", "Blocked"],
    status_renames: [{ from: "A", to: "Moved" }, { from: "B", to: "Blocked" }],
    expected_status_options_version: 0,
  })).status, 500);
  const { rows: [project] } = await db.query("SELECT * FROM projects WHERE id = $1", [a]);
  assert.deepEqual(project.status_options, ["A", "B"]);
  assert.equal(project.status_options_version, 0);
  const { rows } = await db.query("SELECT status FROM tasks WHERE project_id = $1 ORDER BY id", [a]);
  assert.deepEqual(rows.map(({ status }) => status), ["A", "B"]);
});
