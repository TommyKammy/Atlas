import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function field(project, type, config = {}) {
  const { rows: [row] } = await db.query(
    "INSERT INTO custom_fields (project_id, name, field_type, config) VALUES ($1,$2,$3,$4::jsonb) RETURNING id",
    [project, `AR07 ${type}`, type, JSON.stringify(config)],
  );
  return Number(row.id);
}

async function stored(taskId, fieldId) {
  return (await db.query(
    "SELECT value_text, value_number, value_date::text AS value_date, value_json FROM task_custom_values WHERE task_id=$1 AND field_id=$2",
    [taskId, fieldId],
  )).rows[0];
}

async function legacyRuleRun(fixture, subject, fieldId, value) {
  // Install old definitions directly so execution validates data created before the fix.
  const definition = { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.set_custom_field", params: { field_id: fieldId, value } }] };
  const { rows: [rule] } = await db.query(
    `INSERT INTO project_rules (workspace_id, project_id, owner_id, name, definition)
     VALUES (1,$1,$2,'AR07 legacy value',$3::jsonb) RETURNING id`,
    [fixture.a, fixture.ownerId, JSON.stringify(definition)],
  );
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, data)
     VALUES (1,$1,$2,'task.manual_rule','task',$3,jsonb_build_object('target_rule_id',$4::bigint)) RETURNING id`,
    [fixture.a, fixture.ownerId, subject, rule.id],
  );
  const response = await http("/api/automation/process?limit=100", {
    method: "POST", headers: { "x-automation-token": "atlas-regression-worker" }, timeout: 15_000,
  });
  assert.equal(response.status, 200, await response.text());
  const run = (await db.query("SELECT status, details, error FROM rule_runs WHERE rule_id=$1 AND event_id=$2", [rule.id, event.id])).rows[0];
  assert.ok(run, "the seeded event should produce an execution history");
  return { run, eventId: Number(event.id) };
}

test("AR07 legacy invalid member/reference/date/read-only actions preserve existing values", { timeout: 45_000 }, async () => {
  const fixture = await fixtures("AR07 invalid values");
  const subject = await task(fixture.a, "AR07 target");
  const source = await task(fixture.b, "AR07 reference target");
  const people = await field(fixture.a, "people");
  const reference = await field(fixture.a, "reference", { source_project_ids: [fixture.b] });
  const date = await field(fixture.a, "date");
  const readonly = await field(fixture.a, "formula", { expression: "1" });
  const baseline = [
    [people, [fixture.ownerId]], [reference, [source]], [date, "2026-03-01"],
  ];
  for (const [fieldId, value] of baseline) {
    await request(fixture.owner, "POST", "/api/task-values", 201, { task_id: subject, field_id: fieldId, value });
  }
  await db.query("INSERT INTO task_custom_values (task_id,field_id,value_text) VALUES ($1,$2,'keep computed value')", [subject, readonly]);
  const invalid = [
    [people, String(fixture.ownerId)], [people, [2_147_483_647]], [people, [fixture.ownerId, "bad"]],
    [reference, String(source)], [reference, [subject]], [date, "2026-02-30"], [date, "invalid"],
    [readonly, "overwrite computed value"],
  ];
  for (const [fieldId, value] of invalid) {
    const previous = await stored(subject, fieldId);
    const { run } = await legacyRuleRun(fixture, subject, fieldId, value);
    assert.equal(run.status, "failed", JSON.stringify(run));
    assert.deepEqual(await stored(subject, fieldId), previous, `field ${fieldId} changed after invalid input`);
  }
  for (const [fieldId, value] of [[people, "wrong shape"], [reference, "wrong shape"], [date, 20260101]]) {
    const previous = await stored(subject, fieldId);
    await request(fixture.owner, "POST", "/api/task-values", 400, { task_id: subject, field_id: fieldId, value });
    assert.deepEqual(await stored(subject, fieldId), previous);
  }
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [fixture.b, fixture.ownerId]);
  const beforeDenied = await stored(subject, reference);
  const { run } = await legacyRuleRun(fixture, subject, reference, [source]);
  assert.equal(run.status, "failed");
  assert.match(run.error, /source project access denied/);
  assert.deepEqual(await stored(subject, reference), beforeDenied);
  const descriptors = await request(fixture.owner, "GET", `/api/projects/${fixture.a}/automation/descriptors`, 200);
  const options = descriptors.actions.find((action) => action.id === "task.set_custom_field").params.find((param) => param.name === "field_id").options;
  assert.ok(!options.some((option) => Number(option.value) === readonly));
  assert.ok(!descriptors.customFields.some((entry) => entry.id === readonly));
});

test("AR07 valid typed actions use task-editor names and equal values emit no further event", { timeout: 25_000 }, async () => {
  const fixture = await fixtures("AR07 valid values");
  const subject = await task(fixture.a, "AR07 valid target");
  const source = await task(fixture.b, "AR07 named reference");
  for (const [type, config, value] of [
    ["people", {}, [fixture.ownerId]],
    ["reference", { source_project_ids: [fixture.b] }, [source]],
    ["date", {}, "2028-02-29"],
    ["multi_select", {}, "Red, Blue"],
  ]) {
    const fieldId = await field(fixture.a, type, config);
    const first = await legacyRuleRun(fixture, subject, fieldId, value);
    assert.equal(first.run.status, "success", JSON.stringify(first.run));
    const valueBefore = await stored(subject, fieldId);
    if (type === "reference") assert.equal(valueBefore.value_text, "AR07 named reference");
    if (type === "people") assert.match(valueBefore.value_text, /AR07 valid values owner/);
    const second = await legacyRuleRun(fixture, subject, fieldId, value);
    assert.equal(second.run.status, "success");
    assert.equal(second.run.details[0].result.unchanged, true);
    const chained = await db.query("SELECT id FROM domain_events WHERE causation_id=$1", [second.eventId]);
    assert.equal(chained.rowCount, 0);
    assert.deepEqual(await stored(subject, fieldId), valueBefore);
  }
});

test("AR05 custom-field update and clear roll back when outbox insertion fails", { timeout: 15_000 }, async (t) => {
  const fixture = await fixtures("AR05 field atomicity");
  const subject = await task(fixture.a, "AR05 field target");
  const fieldId = await field(fixture.a, "text");
  await request(fixture.owner, "POST", "/api/task-values", 201, { task_id: subject, field_id: fieldId, value: "kept" });
  await db.query(`
    CREATE FUNCTION regression_ar05_field_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.subject_id = ${subject} AND NEW.type = 'task.custom_field_changed' THEN
        RAISE EXCEPTION 'AR05 injected field outbox failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER regression_ar05_field_outbox BEFORE INSERT ON domain_events
      FOR EACH ROW EXECUTE FUNCTION regression_ar05_field_outbox();
  `);
  t.after(() => db.query("DROP TRIGGER IF EXISTS regression_ar05_field_outbox ON domain_events; DROP FUNCTION IF EXISTS regression_ar05_field_outbox()"));
  for (const value of ["changed", null]) {
    const response = await http("/api/task-values", {
      cookie: fixture.owner, method: "POST", json: { task_id: subject, field_id: fieldId, value },
    });
    assert.equal(response.status, 500, await response.text());
    assert.equal((await stored(subject, fieldId)).value_text, "kept");
  }
});
