import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

const pinPath = (id) => `/api/tasks/${id}/timeline-row`;
const membershipPath = (id, project) => `/api/memberships?task_id=${id}&project_id=${project}`;

async function pinRows(id) {
  const result = await db.query(
    "SELECT project_id, row_index FROM task_timeline_rows WHERE task_id = $1 ORDER BY project_id",
    [id],
  );
  return result.rows.map(({ project_id, row_index }) => [Number(project_id), row_index]);
}

test("R08/R13 removing and re-adding a membership discards its timeline pin and stamp", async () => {
  const { a, b, owner } = await fixtures("Timeline membership placement");
  const id = await task(a, "Task with two pins");
  const { rows: [first, second] } = await db.query(
    "INSERT INTO sections (project_id, name) VALUES ($1, 'First'), ($1, 'Second') RETURNING id",
    [b],
  );
  const add = (section) => request(owner, "POST", "/api/memberships", 201, {
    task_id: id, project_id: b, section_id: Number(section.id),
  });
  await add(first);
  await request(owner, "PUT", pinPath(id), 200, { project_id: a, row_index: 3, expected_updated_at: null });
  const old = await request(owner, "PUT", pinPath(id), 200, {
    project_id: b, row_index: 7, expected_updated_at: null,
  });
  await request(owner, "DELETE", membershipPath(id, b), 200);
  assert.deepEqual(await pinRows(id), [[a, 3]]);
  await request(owner, "DELETE", membershipPath(id, a), 200);
  assert.deepEqual(await pinRows(id), [[a, 3]], "deleting a secondary membership cannot clear the primary pin");
  await add(second);
  await request(owner, "PUT", pinPath(id), 409, {
    project_id: b, row_index: 8, expected_updated_at: old.updated_at,
  });
  await request(owner, "PUT", pinPath(id), 200, {
    project_id: b, row_index: 8, expected_updated_at: null,
  });
  assert.deepEqual(await pinRows(id), [[a, 3], [b, 8]]);
});

async function waitForBlockedQuery(pattern) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await db.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`,
      [pattern],
    );
    if (result.rowCount > 0) return;
    await delay(25);
  }
  assert.fail(`Expected query to wait for a lock: ${pattern}`);
}

test("R08/R13 a pin queued behind membership removal cannot recreate the removed placement", async () => {
  const { a, b, owner } = await fixtures("Timeline membership race");
  const id = await task(a, "Concurrent placement");
  await request(owner, "POST", "/api/memberships", 201, { task_id: id, project_id: b });
  const locker = await db.connect();
  let removing;
  let pinning;
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE task_project_memberships IN SHARE MODE");
    removing = http(membershipPath(id, b), { cookie: owner, method: "DELETE", timeout: 10_000 });
    void removing.catch(() => undefined);
    await waitForBlockedQuery("DELETE FROM task_project_memberships%");
    pinning = http(pinPath(id), {
      cookie: owner, method: "PUT", timeout: 10_000,
      json: { project_id: b, row_index: 7, expected_updated_at: null },
    });
    void pinning.catch(() => undefined);
    await waitForBlockedQuery("SELECT project_id FROM tasks%deleted_at IS NULL FOR UPDATE");
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
  const [removed, pinned] = await Promise.all([removing, pinning]);
  assert.equal(removed.status, 200, await removed.text());
  assert.equal(pinned.status, 404, await pinned.text());
  assert.deepEqual(await pinRows(id), []);
});

test("migration 0011 removes only orphaned timeline pins", async () => {
  const { a, b } = await fixtures("Orphaned timeline pin");
  const orphaned = await task(a, "Old orphaned pin");
  const shared = await task(a, "Valid secondary pin");
  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [shared, b]);
  await db.query(
    `INSERT INTO task_timeline_rows (task_id, project_id, row_index)
     VALUES ($1, $3, 2), ($1, $4, 3), ($2, $4, 4)`,
    [orphaned, shared, a, b],
  );
  const sql = await readFile(new URL("../db/migrations/0011_remove_orphan_task_timeline_rows.sql", import.meta.url), "utf8");
  await db.query(sql);
  assert.deepEqual(await pinRows(orphaned), [[a, 2]]);
  assert.deepEqual(await pinRows(shared), [[b, 4]]);
});
