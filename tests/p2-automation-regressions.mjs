import assert from "node:assert/strict";
import { test } from "node:test";
import { processScheduledTriggers } from "../lib/automation/scheduled.ts";
import { db, fixtures } from "./regression-fixtures.mjs";

async function createRule(t, { project, ownerId, name, event, days = 0 }) {
  const { rows: [rule] } = await db.query(
    `INSERT INTO project_rules (workspace_id, project_id, owner_id, name, definition)
     VALUES (1, $1, $2, $3, $4::jsonb) RETURNING id`,
    [project, ownerId, name, JSON.stringify({
      version: 1,
      triggers: [{ event, days }],
      actions: [{ capability: "task.set_status", params: { status: "Scheduled" } }],
    })],
  );
  t.after(() => db.query("UPDATE project_rules SET enabled = FALSE WHERE id = $1", [rule.id]));
  return rule.id;
}

async function tasksDue(project, day, count = 1) {
  const { rows } = await db.query(
    `INSERT INTO tasks (project_id, name, due_on)
     SELECT $1, 'R18 task ' || i, $2::date FROM generate_series(1, $3::int) i
     RETURNING id`,
    [project, day, count],
  );
  return rows.map(({ id }) => id);
}

async function scheduledRows(ruleId) {
  const { rows } = await db.query(
    `SELECT subject_id, type, data FROM domain_events
     WHERE data->>'target_rule_id' = $1::text ORDER BY subject_id`,
    [ruleId],
  );
  return rows;
}

async function fireCount(ruleId) {
  const { rows: [row] } = await db.query(
    "SELECT count(*)::int AS n FROM automation_fires WHERE rule_id = $1",
    [ruleId],
  );
  return row.n;
}

test("R18 uses the JST date boundary even when the database session uses UTC", { timeout: 10_000 }, async (t) => {
  const { a: project, ownerId } = await fixtures("R18 JST boundary");
  const soon = await createRule(t, { project, ownerId, name: "R18 JST due soon", event: "task.due_soon" });
  const overdue = await createRule(t, { project, ownerId, name: "R18 JST overdue", event: "task.overdue" });
  const [yesterday] = await tasksDue(project, "2042-01-01");
  const [today] = await tasksDue(project, "2042-01-02");

  const client = await db.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await processScheduledTriggers(client, new Date("2042-01-01T14:59:59.000Z"));
    assert.deepEqual((await scheduledRows(soon)).map((row) => row.subject_id), [yesterday]);
    assert.deepEqual(await scheduledRows(overdue), []);

    // UTC still has the same date. Only the application's calendar day has changed.
    await processScheduledTriggers(client, new Date("2042-01-01T15:00:00.000Z"));
    assert.deepEqual((await scheduledRows(soon)).map((row) => row.subject_id), [yesterday, today]);
    const lateRows = await scheduledRows(overdue);
    assert.deepEqual(lateRows.map((row) => row.subject_id), [yesterday]);
    assert.equal(lateRows[0].data.due_on, "2042-01-01");
  } finally {
    client.release();
  }
});

test("R18 filters fire keys before the batch limit and makes the 151st task reachable", { timeout: 10_000 }, async (t) => {
  const { a: project, ownerId } = await fixtures("R18 backlog");
  const rule = await createRule(t, { project, ownerId, name: "R18 backlog", event: "task.overdue", days: 1 });
  const ids = await tasksDue(project, "2042-02-01", 151);
  const now = new Date("2042-02-03T00:00:00.000Z");
  await processScheduledTriggers(db, now);
  assert.deepEqual((await scheduledRows(rule)).map((row) => row.subject_id), ids.slice(0, 150));
  await processScheduledTriggers(db, now);
  await processScheduledTriggers(db, now);
  assert.deepEqual((await scheduledRows(rule)).map((row) => row.subject_id), ids);
  assert.equal(await fireCount(rule), 151);
});

test("R18 two simultaneous scanners enqueue only one event per key", { timeout: 10_000 }, async (t) => {
  const { a: project, ownerId } = await fixtures("R18 concurrent scan");
  const rule = await createRule(t, { project, ownerId, name: "R18 concurrent scan", event: "task.due_soon" });
  const ids = await tasksDue(project, "2042-03-01", 5);
  // Keep the two INSERT statements overlapping after they select candidates.
  await db.query(`
    CREATE FUNCTION regression_delay_schedule_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.2);
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER regression_delay_schedule_insert BEFORE INSERT ON automation_fires
      FOR EACH STATEMENT EXECUTE FUNCTION regression_delay_schedule_insert();
  `);
  t.after(() => db.query(`
    DROP TRIGGER IF EXISTS regression_delay_schedule_insert ON automation_fires;
    DROP FUNCTION IF EXISTS regression_delay_schedule_insert();
  `));
  const now = new Date("2042-03-01T00:00:00.000Z");
  await Promise.all([processScheduledTriggers(db, now), processScheduledTriggers(db, now)]);
  const rows = await scheduledRows(rule);
  assert.deepEqual(rows.map((row) => row.subject_id), ids);
  assert.equal(new Set(rows.map((row) => row.data.fire_key)).size, ids.length);
  assert.equal(await fireCount(rule), ids.length);
});

test("R18 an outbox insert failure rolls back its fire keys and a later scan can recover", { timeout: 10_000 }, async (t) => {
  const { a: project, ownerId } = await fixtures("R18 atomic schedule");
  const rule = await createRule(t, { project, ownerId, name: "R18 atomic schedule", event: "task.due_soon" });
  const ids = await tasksDue(project, "2042-04-01", 2);
  await db.query(`
    CREATE FUNCTION regression_fail_schedule_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'task.due_soon' AND EXISTS (
        SELECT 1 FROM project_rules WHERE id = (NEW.data->>'target_rule_id')::bigint
          AND name = 'R18 atomic schedule'
      ) THEN
        RAISE EXCEPTION 'regression outbox failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER regression_fail_schedule_outbox BEFORE INSERT ON domain_events
      FOR EACH ROW EXECUTE FUNCTION regression_fail_schedule_outbox();
  `);
  t.after(() => db.query(`
    DROP TRIGGER IF EXISTS regression_fail_schedule_outbox ON domain_events;
    DROP FUNCTION IF EXISTS regression_fail_schedule_outbox();
  `));
  const now = new Date("2042-04-01T00:00:00.000Z");
  await assert.rejects(processScheduledTriggers(db, now), /regression outbox failure/);
  assert.equal(await fireCount(rule), 0);
  assert.deepEqual(await scheduledRows(rule), []);
  await db.query("DROP TRIGGER regression_fail_schedule_outbox ON domain_events");
  await processScheduledTriggers(db, now);
  assert.equal(await fireCount(rule), ids.length);
  assert.deepEqual((await scheduledRows(rule)).map((row) => row.subject_id), ids);
});
