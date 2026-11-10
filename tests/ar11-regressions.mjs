import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { processScheduledTriggers } from "../lib/automation/scheduled.ts";
import { db, fixtures, request, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function createRule(t, fixture, event = "task.due_soon", days, legacy = false) {
  const definition = {
    triggers: [{ event, ...(days === undefined ? {} : { days }) }],
    actions: [{ capability: "task.create", params: { name: "AR11 follow-up" } }],
  };
  let id;
  if (legacy) {
    const { rows: [row] } = await db.query(
      `INSERT INTO project_rules (workspace_id, project_id, owner_id, name, definition)
       VALUES (1, $1, $2, 'AR11 legacy schedule', $3::jsonb) RETURNING id`,
      [fixture.a, fixture.ownerId, JSON.stringify(definition)],
    );
    id = Number(row.id);
  } else {
    ({ id } = await request(fixture.owner, "POST", `/api/projects/${fixture.a}/rules`, 201, {
      name: "AR11 schedule", definition,
    }));
    await request(fixture.owner, "PATCH", `/api/projects/${fixture.a}/rules/${id}`, 200, { enabled: true });
  }
  t.after(() => db.query("UPDATE project_rules SET enabled = FALSE WHERE id = $1", [id]));
  return id;
}

async function tasksDue(projectId, day, count = 1) {
  const { rows } = await db.query(
    `INSERT INTO tasks (project_id, name, due_on)
     SELECT $1, 'AR11 task ' || i, $2::date FROM generate_series(1, $3::int) i RETURNING id`,
    [projectId, day, count],
  );
  return rows.map(({ id }) => Number(id));
}

async function scheduledIds(ruleId) {
  return (await db.query(
    "SELECT subject_id FROM domain_events WHERE data->>'target_rule_id' = $1::text ORDER BY subject_id",
    [ruleId],
  )).rows.map(({ subject_id }) => Number(subject_id));
}

async function cursorDay(ruleId, days = 0) {
  const { rows: [row] } = await db.query(
    "SELECT scan_from::text FROM automation_due_soon_scans WHERE rule_id = $1 AND days = $2",
    [ruleId, days],
  );
  return row?.scan_from;
}

test("AR11 saved and legacy due-soon defaults mean tomorrow while explicit zero means today", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 default day");
  const saved = await createRule(t, fixture);
  const legacy = await createRule(t, fixture, "task.due_soon", undefined, true);
  const sameDay = await createRule(t, fixture, "task.due_soon", 0);
  const { rows: [stored] } = await db.query("SELECT definition FROM project_rules WHERE id = $1", [saved]);
  assert.equal(stored.definition.triggers[0].days, 1);
  const today = await tasksDue(fixture.a, "2042-06-02");
  const tomorrow = await tasksDue(fixture.a, "2042-06-03");
  await processScheduledTriggers(db, new Date("2042-06-01T15:00:00.000Z"));
  assert.deepEqual(await scheduledIds(saved), tomorrow);
  assert.deepEqual(await scheduledIds(legacy), tomorrow);
  assert.deepEqual(await scheduledIds(sameDay), today);
});

test("AR11 a final JST scan keeps the 151st task across midnight and later missed scan dates", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 midnight backlog");
  const rule = await createRule(t, fixture, "task.due_soon", 0);
  const yesterday = await tasksDue(fixture.a, "2042-07-01", 151);
  const nextDay = await tasksDue(fixture.a, "2042-07-02");
  const laterDay = await tasksDue(fixture.a, "2042-07-03");
  await processScheduledTriggers(db, new Date("2042-07-01T14:59:59.000Z"));
  assert.deepEqual(await scheduledIds(rule), yesterday.slice(0, 150));
  assert.equal(await cursorDay(rule), "2042-07-01");
  await processScheduledTriggers(db, new Date("2042-07-02T15:00:00.000Z"));
  assert.deepEqual(await scheduledIds(rule), [...yesterday, ...nextDay, ...laterDay]);
  await processScheduledTriggers(db, new Date("2042-07-02T15:00:00.000Z"));
  assert.equal(await cursorDay(rule), "2042-07-03");
});

test("AR11 a worker stopping after durable cursor creation can resume after midnight", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 scanner restart");
  const rule = await createRule(t, fixture, "task.due_soon", 0);
  const ids = await tasksDue(fixture.a, "2042-08-01", 2);
  let initialized = false;
  const interrupted = {
    query: async (sql, params) => {
      if (initialized && sql.includes("active_rule AS") && String(params?.[0]) === String(rule)) {
        throw new Error("AR11 simulated worker stop");
      }
      const result = await db.query(sql, params);
      if (sql.includes("INSERT INTO automation_due_soon_scans") && String(params?.[0]) === String(rule)) {
        initialized = true;
      }
      return result;
    },
  };
  await assert.rejects(processScheduledTriggers(interrupted, new Date("2042-08-01T14:59:59.000Z")), /simulated worker stop/);
  assert.equal(await cursorDay(rule), "2042-08-01");
  assert.deepEqual(await scheduledIds(rule), []);
  await processScheduledTriggers(db, new Date("2042-08-01T15:00:00.000Z"));
  assert.deepEqual(await scheduledIds(rule), ids);
});

test("AR11 outbox failure rolls back fire keys while retaining the retry date", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 atomic recovery");
  const rule = await createRule(t, fixture, "task.due_soon", 0);
  const ids = await tasksDue(fixture.a, "2042-09-01", 2);
  const name = `ar11_${randomUUID().replaceAll("-", "")}`;
  await db.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.data->>'target_rule_id' = '${rule}' THEN RAISE EXCEPTION 'AR11 outbox failure'; END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION ${name}();
  `);
  t.after(() => db.query(`DROP TRIGGER IF EXISTS ${name} ON domain_events; DROP FUNCTION IF EXISTS ${name}()`));
  await assert.rejects(processScheduledTriggers(db, new Date("2042-09-01T14:59:59.000Z")), /AR11 outbox failure/);
  assert.equal(await cursorDay(rule), "2042-09-01");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM automation_fires WHERE rule_id = $1", [rule])).rows[0].n, 0);
  assert.deepEqual(await scheduledIds(rule), []);
  await db.query(`DROP TRIGGER ${name} ON domain_events`);
  await processScheduledTriggers(db, new Date("2042-09-01T15:00:00.000Z"));
  assert.deepEqual(await scheduledIds(rule), ids);
});

test("AR11 simultaneous scanners preserve a pending date and one event per fire key", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 concurrent scans");
  const rule = await createRule(t, fixture, "task.due_soon", 0);
  const ids = await tasksDue(fixture.a, "2042-10-01", 151);
  const name = `ar11_${randomUUID().replaceAll("-", "")}`;
  await db.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.05);
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON automation_fires FOR EACH STATEMENT EXECUTE FUNCTION ${name}();
  `);
  t.after(() => db.query(`DROP TRIGGER IF EXISTS ${name} ON automation_fires; DROP FUNCTION IF EXISTS ${name}()`));
  const beforeMidnight = new Date("2042-10-01T14:59:59.000Z");
  await Promise.all([processScheduledTriggers(db, beforeMidnight), processScheduledTriggers(db, beforeMidnight)]);
  const afterMidnight = new Date("2042-10-01T15:00:00.000Z");
  await Promise.all([processScheduledTriggers(db, afterMidnight), processScheduledTriggers(db, afterMidnight)]);
  await processScheduledTriggers(db, afterMidnight);
  assert.deepEqual(await scheduledIds(rule), ids);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM automation_fires WHERE rule_id = $1", [rule])).rows[0].n, ids.length);
});

test("AR11 overdue thresholds retain their existing JST semantics without a due-soon cursor", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR11 overdue compatibility");
  const anyLate = await createRule(t, fixture, "task.overdue", 0);
  const twoDaysLate = await createRule(t, fixture, "task.overdue", 2);
  const oldest = await tasksDue(fixture.a, "2042-11-01");
  const yesterday = await tasksDue(fixture.a, "2042-11-02");
  await tasksDue(fixture.a, "2042-11-03");
  await processScheduledTriggers(db, new Date("2042-11-02T15:00:00.000Z"));
  assert.deepEqual(await scheduledIds(anyLate), [...oldest, ...yesterday]);
  assert.deepEqual(await scheduledIds(twoDaysLate), oldest);
  assert.equal(await cursorDay(anyLate), undefined);
  assert.equal(await cursorDay(twoDaysLate, 2), undefined);
});
