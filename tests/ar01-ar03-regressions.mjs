import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(async () => {
  // The disposable suite shares an outbox with earlier tests and disables polling.
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

const createTask = (name) => ({ capability: "task.create", params: { name } });
const definition = (event, actions) => ({ triggers: [{ event }], actions });

async function processEvents() {
  const response = await http("/api/automation/process?limit=20", {
    method: "POST", timeout: 10_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  assert.equal(response.status, 200, await response.text());
}

async function createRule(cookie, projectId, name, value) {
  return (await request(cookie, "POST", `/api/projects/${projectId}/rules`, 201, { name, definition: value })).id;
}

async function insertLegacyRule(projectId, ownerId, name, value) {
  const { rows: [rule] } = await db.query(
    `INSERT INTO project_rules (workspace_id, project_id, owner_id, name, definition)
     VALUES (1, $1, $2, $3, $4::jsonb) RETURNING id`,
    [projectId, ownerId, name, JSON.stringify(value)],
  );
  return Number(rule.id);
}

test("AR01 rules on shared tasks only expand custom values from the rule project", async () => {
  const { a, b, editor } = await fixtures("AR01 shared task");
  await request(editor, "GET", `/api/projects/${b}/rules`, 403);
  const shared = await task(b, "Shared task");
  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [shared, a]);
  const { rows: [localField, privateField] } = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type)
     VALUES ($1, 'Local review field', 'text'), ($2, 'Private review field', 'text') RETURNING id`,
    [a, b],
  );
  const localValue = "AR01 authorized value";
  const privateValue = "AR01 restricted value";
  await db.query(
    "INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, $3), ($1, $4, $5)",
    [shared, localField.id, localValue, privateField.id, privateValue],
  );
  const rule = await createRule(editor, a, "AR01 shared snapshot", definition("task.manual_rule", [
    createTask(`{{custom.${localField.id}}}`),
    createTask(`{{custom.${privateField.id}}}`),
  ]));
  await request(editor, "POST", `/api/projects/${a}/rules/${rule}/run`, 201, { task_id: shared });

  const { rows } = await db.query("SELECT name FROM tasks WHERE project_id = $1 ORDER BY id", [a]);
  assert.deepEqual(rows.map(({ name }) => name), [localValue]);
});

test("AR01 a queued event cannot expand the name of a task moved out of the rule project", async () => {
  const { a, b, editor, editorId } = await fixtures("AR01 moved task");
  const subject = await task(a, "Visible before move");
  const rule = await createRule(editor, a, "AR01 stale event", definition("task.assigned", [
    createTask("{{task.name}}"),
  ]));
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, data)
     VALUES (1, $1, $2, 'task.assigned', 'task', $3, jsonb_build_object('target_rule_id', $4::bigint)) RETURNING id`,
    [a, editorId, subject, rule],
  );
  const privateName = "AR01 private name after move";
  await db.query("UPDATE tasks SET project_id = $1, name = $2 WHERE id = $3", [b, privateName, subject]);
  await processEvents();

  const { rows: [finished] } = await db.query("SELECT processed_at, failed_at FROM domain_events WHERE id = $1", [event.id]);
  assert.ok(finished.processed_at || finished.failed_at, "the stale event should reach a terminal state");
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = $2", [a, privateName])).rowCount, 0);
});

test("AR01 a persisted task plan from before the scope checks cannot resume", async () => {
  const { a, owner, ownerId } = await fixtures("AR01 old plan");
  const subject = await task(a, "Authorized task");
  const resultName = "AR01 unverified precomputed value";
  const actions = [createTask(resultName)];
  const rule = await createRule(owner, a, "AR01 old plan rule", definition("task.assigned", actions));
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, automation_plan_ready)
     VALUES (1, $1, $2, 'task.assigned', 'task', $3, TRUE) RETURNING id`,
    [a, ownerId, subject],
  );
  await db.query(
    `INSERT INTO automation_rule_executions
       (event_id, rule_id, rule_version, rule_name, owner_id, actions, planned_attempt, delivery_seed)
     VALUES ($1, $2, 1, 'AR01 old plan rule', $3, $4::jsonb, 1, $5)`,
    [event.id, rule, ownerId, JSON.stringify(actions), randomUUID()],
  );
  await processEvents();

  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = $2", [a, resultName])).rowCount, 0);
  const { rows: [run] } = await db.query("SELECT status FROM rule_runs WHERE event_id = $1 AND rule_id = $2", [event.id, rule]);
  assert.equal(run?.status, "failed");
});

test("AR02 a legacy project-status rule cannot complete an unrelated task with a matching numeric ID", async () => {
  const { a, owner, ownerId } = await fixtures("AR02 coincident IDs");
  const { rows: [{ id }] } = await db.query(
    `SELECT GREATEST((SELECT max(id) FROM tasks), (SELECT max(id) FROM projects)) + 1000000 AS id`,
  );
  await db.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, 1, 'AR02 rule project')", [id]);
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')", [id, ownerId]);
  await db.query("INSERT INTO tasks (id, project_id, name) VALUES ($1, $2, 'AR02 unrelated task')", [id, a]);
  const value = definition("project.status_changed", [{ capability: "task.complete", params: {} }]);
  await insertLegacyRule(id, ownerId, "AR02 legacy rule", value);

  await request(owner, "POST", `/api/projects/${id}/status-updates`, 201, { body: "AR02 status update", status: "active" });
  await processEvents();

  const { rows: [unrelated] } = await db.query("SELECT completed FROM tasks WHERE id = $1", [id]);
  assert.equal(unrelated.completed, false);
  await request(owner, "POST", `/api/projects/${id}/rules`, 400, { name: "AR02 incompatible rule", definition: value });

  const explicitTask = await task(a, "AR02 explicitly selected task");
  await createRule(owner, id, "AR02 explicit task rule", definition("project.status_changed", [
    { capability: "task.complete", params: { task_id: explicitTask } },
    { capability: "task.create", params: { project_id: a, name: "AR02 explicit destination" } },
  ]));
  await request(owner, "POST", `/api/projects/${id}/status-updates`, 201, { body: "AR02 explicit target update", status: "active" });
  // Existing legacy failures may defer the event before its later valid rule.
  let completed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await processEvents();
    const { rows: [selected] } = await db.query("SELECT completed FROM tasks WHERE id = $1", [explicitTask]);
    completed = selected.completed;
    if (completed) break;
    await delay(300);
  }
  const { rows: runs } = await db.query(
    `SELECT rr.status, rr.error, rr.details FROM rule_runs rr
     JOIN project_rules r ON r.id = rr.rule_id WHERE r.project_id = $1 ORDER BY rr.id`,
    [id],
  );
  const { rows: events } = await db.query(
    "SELECT type, subject_type, subject_id, processed_at, failed_at, last_error FROM domain_events WHERE project_id = $1 ORDER BY id",
    [id],
  );
  assert.equal(completed, true, JSON.stringify({ runs, events }));
  const { rows: [created] } = await db.query("SELECT project_id FROM tasks WHERE name = 'AR02 explicit destination'");
  assert.equal(Number(created?.project_id), a);
});

test("AR03 deleting a preceding action preserves a legacy webhook's existing signing key", async () => {
  const { a, owner, ownerId } = await fixtures("AR03 signed webhook");
  const secret = "AR03 synthetic signing key";
  const rule = await insertLegacyRule(a, ownerId, "AR03 legacy webhook", definition("task.manual_rule", [
    { capability: "task.complete", params: {} },
    { capability: "webhook.post", params: { url: "https://example.com/hooks", secret } },
  ]));
  const { rules } = await request(owner, "GET", `/api/projects/${a}/rules`, 200);
  const edit = rules.find(({ id }) => id === rule).definition;
  assert.equal(edit.actions[1].params.secret, undefined);
  await request(owner, "PATCH", `/api/projects/${a}/rules/${rule}`, 200, {
    definition: { ...edit, actions: edit.actions.slice(1) },
  });

  const { rows: [saved] } = await db.query("SELECT definition FROM project_rules WHERE id = $1", [rule]);
  assert.equal(saved.definition.actions[0].params.secret, secret);
});
