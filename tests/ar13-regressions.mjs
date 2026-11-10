import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { before, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function sections(projectId) {
  const { rows } = await db.query(
    "INSERT INTO sections (project_id,name) VALUES ($1,'AR13 before'),($1,'AR13 after') RETURNING id",
    [projectId],
  );
  return rows.map((row) => Number(row.id));
}

async function placementFixture(label) {
  const fixture = await fixtures(label);
  const [oldA, newA] = await sections(fixture.a);
  const [oldB, newB] = await sections(fixture.b);
  const subject = await task(fixture.b, "AR13 shared task");
  await db.query("UPDATE tasks SET section_id=$2 WHERE id=$1", [subject, oldB]);
  await db.query("INSERT INTO task_project_memberships (task_id,project_id,section_id) VALUES ($1,$2,$3)", [subject, fixture.a, oldA]);
  await db.query("INSERT INTO task_timeline_rows (task_id,project_id,row_index) VALUES ($1,$2,1),($1,$3,2)", [subject, fixture.a, fixture.b]);
  return { ...fixture, oldA, newA, oldB, newB, subject };
}

async function createRule(cookie, projectId, name, sectionId, extra = {}) {
  return (await request(cookie, "POST", `/api/projects/${projectId}/rules`, 201, {
    name,
    definition: {
      triggers: [{ event: "task.manual_rule" }],
      actions: [{ capability: "task.move_section", params: { section_id: sectionId } }],
      ...extra,
    },
  })).id;
}

async function enqueue(projectId, actorId, subject, ruleId, type = "task.manual_rule", subjectType = "task") {
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events (workspace_id,project_id,actor_id,type,subject_type,subject_id,data)
     VALUES (1,$1,$2,$3,$4,$5,jsonb_build_object('target_rule_id',$6::bigint)) RETURNING id`,
    [projectId, actorId, type, subjectType, subject, ruleId],
  );
  return Number(event.id);
}

async function processEvents() {
  const response = await http("/api/automation/process?limit=100", {
    method: "POST", timeout: 15_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  assert.equal(response.status, 200, await response.text());
}

async function drain(projectId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await processEvents();
    const { rows: [{ n }] } = await db.query(
      "SELECT count(*)::int AS n FROM domain_events WHERE project_id=$1 AND processed_at IS NULL AND failed_at IS NULL", [projectId],
    );
    if (n === 0) return;
  }
  assert.fail("AR13 fixture did not reach a terminal event state");
}

async function primary(subject) {
  return (await db.query("SELECT project_id,section_id,updated_at::text FROM tasks WHERE id=$1", [subject])).rows[0];
}

async function pins(subject) {
  return (await db.query("SELECT project_id,row_index FROM task_timeline_rows WHERE task_id=$1 ORDER BY project_id", [subject])).rows;
}

test("AR13 source-project move changes only the secondary section and pin with matching event scope", { timeout: 30_000 }, async () => {
  const f = await placementFixture("AR13 secondary");
  const before = await primary(f.subject);
  const id = await createRule(f.editor, f.a, "Move within secondary A", f.newA);
  await request(f.editor, "POST", `/api/projects/${f.a}/rules`, 201, {
    name: "Observe scoped section",
    definition: {
      triggers: [{ event: "task.section_changed", filters: { section_id: f.newA } }],
      conditions: [{ field: "task.section_id", op: "eq", value: f.newA }],
      actions: [{ capability: "task.create", params: { name: "AR13 source section observed" } }],
    },
  });
  const eventId = await enqueue(f.a, f.editorId, f.subject, id);
  await drain(f.a);
  const after = await primary(f.subject);
  assert.equal(after.project_id, before.project_id);
  assert.equal(after.section_id, before.section_id);
  assert.notEqual(after.updated_at, before.updated_at);
  assert.equal((await db.query("SELECT section_id FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a])).rows[0].section_id, String(f.newA));
  assert.deepEqual(await pins(f.subject), [{ project_id: String(f.b), row_index: 2 }]);
  const { rows: [event] } = await db.query("SELECT project_id,data FROM domain_events WHERE causation_id=$1 AND type='task.section_changed'", [eventId]);
  assert.equal(event.project_id, String(f.a));
  assert.deepEqual(event.data, { project_id: f.a, previous_section_id: f.oldA, section_id: f.newA });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1 AND name='AR13 source section observed'", [f.a])).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='automation.task.section_changed' AND entity_id=$1 AND project_id=$2", [f.subject, f.a])).rows[0].n, 1);
  await request(f.editor, "PATCH", `/api/tasks/${f.subject}`, 409, {
    section_id: f.oldA, expected_updated_at: before.updated_at,
  });

  await db.query("INSERT INTO task_timeline_rows (task_id,project_id,row_index) VALUES ($1,$2,3)", [f.subject, f.a]);
  const beforePins = await pins(f.subject);
  const repeated = await enqueue(f.a, f.editorId, f.subject, id);
  await drain(f.a);
  assert.deepEqual(await primary(f.subject), after);
  assert.deepEqual(await pins(f.subject), beforePins);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM domain_events WHERE causation_id=$1", [repeated])).rows[0].n, 0);
  const { rows: [run] } = await db.query("SELECT status,details FROM rule_runs WHERE event_id=$1 AND rule_id=$2", [repeated, id]);
  assert.equal(run.status, "success");
  assert.equal(run.details[0].result.unchanged, true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='automation.task.section_changed' AND entity_id=$1", [f.subject])).rows[0].n, 1);
});

test("AR13 primary and non-task fixed-target moves keep their primary placement behavior", { timeout: 25_000 }, async () => {
  const f = await placementFixture("AR13 primary");
  const id = await createRule(f.owner, f.b, "Move primary B", f.newB);
  const eventId = await enqueue(f.b, f.ownerId, f.subject, id);
  await drain(f.b);
  assert.equal((await primary(f.subject)).section_id, String(f.newB));
  assert.equal((await db.query("SELECT section_id FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a])).rows[0].section_id, String(f.oldA));
  assert.deepEqual(await pins(f.subject), [{ project_id: String(f.a), row_index: 1 }]);
  const { rows: [event] } = await db.query("SELECT project_id,data FROM domain_events WHERE causation_id=$1 AND type='task.section_changed'", [eventId]);
  assert.equal(event.project_id, String(f.b));
  assert.equal(event.data.previous_section_id, f.oldB);

  const fixed = await createRule(f.owner, f.a, "Fixed task primary placement", f.oldB, {
    triggers: [{ event: "project.status_changed" }],
    actions: [{ capability: "task.move_section", params: { task_id: f.subject, section_id: f.oldB } }],
  });
  const fixedEvent = await enqueue(f.a, f.ownerId, f.a, fixed, "project.status_changed", "project");
  await drain(f.a);
  assert.equal((await primary(f.subject)).section_id, String(f.oldB));
  const fixedChange = (await db.query("SELECT project_id,data FROM domain_events WHERE causation_id=$1 AND type='task.section_changed'", [fixedEvent])).rows[0];
  assert.equal(fixedChange.project_id, String(f.b));
  assert.equal(fixedChange.data.previous_section_id, f.newB);
});

test("AR13 a section in another project or loss of source edit permission causes no placement writes", { timeout: 25_000 }, async () => {
  const f = await placementFixture("AR13 invalid scope");
  const before = await primary(f.subject);
  const beforePins = await pins(f.subject);
  const wrong = await createRule(f.editor, f.a, "Reject primary section from A", f.newB);
  const wrongEvent = await enqueue(f.a, f.editorId, f.subject, wrong);
  await drain(f.a);
  const run = (await db.query("SELECT status,error FROM rule_runs WHERE event_id=$1 AND rule_id=$2", [wrongEvent, wrong])).rows[0];
  assert.equal(run.status, "failed");
  assert.match(run.error, /section does not belong/);
  assert.deepEqual(await primary(f.subject), before);
  assert.deepEqual(await pins(f.subject), beforePins);
  const revoked = await createRule(f.owner, f.a, "Source edit revoked", f.newA);
  await db.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2", [f.a, f.ownerId]);
  await enqueue(f.a, f.ownerId, f.subject, revoked);
  await drain(f.a);
  assert.deepEqual(await primary(f.subject), before);
  assert.deepEqual(await pins(f.subject), beforePins);
  assert.equal((await db.query("SELECT section_id FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a])).rows[0].section_id, String(f.oldA));
});

test("AR13 a membership removed while the worker waits cannot be recreated or moved", { timeout: 20_000 }, async () => {
  const f = await placementFixture("AR13 removed membership");
  const id = await createRule(f.editor, f.a, "Move removed secondary", f.newA);
  const eventId = await enqueue(f.a, f.editorId, f.subject, id);
  const before = await primary(f.subject);
  const remover = await db.connect();
  let processing;
  try {
    await remover.query("BEGIN");
    const { rows: [{ pid }] } = await remover.query("SELECT pg_backend_pid() AS pid");
    await remover.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [f.subject]);
    await remover.query("DELETE FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a]);
    await remover.query("DELETE FROM task_timeline_rows WHERE task_id=$1 AND project_id=$2", [f.subject, f.a]);
    processing = processEvents();
    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const blockers = await db.query("SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [pid]);
      if (blockers.rowCount > 0) { waiting = true; break; }
      await delay(20);
    }
    assert.equal(waiting, true, "worker should wait for the membership remover's task lock");
    await remover.query("COMMIT");
  } finally {
    await remover.query("ROLLBACK");
    remover.release();
    if (processing) await processing;
  }
  assert.deepEqual(await primary(f.subject), before);
  assert.equal((await db.query("SELECT 1 FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a])).rowCount, 0);
  assert.deepEqual(await pins(f.subject), [{ project_id: String(f.b), row_index: 2 }]);
  assert.equal((await db.query("SELECT 1 FROM domain_events WHERE causation_id=$1 AND type='task.section_changed'", [eventId])).rowCount, 0);
  assert.match((await db.query("SELECT last_error FROM domain_events WHERE id=$1", [eventId])).rows[0].last_error, /no longer in the active project/);
});

test("AR13 scoped section and pin deletion roll back together when its event cannot be saved", { timeout: 20_000 }, async (t) => {
  const f = await placementFixture("AR13 atomic move");
  const id = await createRule(f.editor, f.a, "Atomic secondary move", f.newA);
  const before = await primary(f.subject);
  const beforePins = await pins(f.subject);
  const name = `ar13_${randomUUID().replaceAll("-", "")}`;
  await db.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'task.section_changed' AND NEW.subject_id = ${f.subject} THEN
        RAISE EXCEPTION 'AR13 injected outbox failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION ${name}();
  `);
  t.after(() => db.query(`DROP TRIGGER IF EXISTS ${name} ON domain_events; DROP FUNCTION IF EXISTS ${name}()`));
  const eventId = await enqueue(f.a, f.editorId, f.subject, id);
  await drain(f.a);
  assert.deepEqual(await primary(f.subject), before);
  assert.deepEqual(await pins(f.subject), beforePins);
  assert.equal((await db.query("SELECT section_id FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [f.subject, f.a])).rows[0].section_id, String(f.oldA));
  assert.equal((await db.query("SELECT status FROM rule_runs WHERE event_id=$1 AND rule_id=$2", [eventId, id])).rows[0].status, "failed");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='automation.task.section_changed' AND entity_id=$1", [f.subject])).rows[0].n, 0);
});
