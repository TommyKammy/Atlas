import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, test } from "node:test";
import { db, fixtures, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(async () => {
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

const definition = (extra = {}) => ({
  triggers: [{ event: "task.created" }], actions: [{ capability: "task.complete", params: {} }], ...extra,
});
const preview = (f) => `/api/projects/${f.a}/rules/preview`;

async function effects() {
  const tables = ["tasks", "comments", "task_custom_values", "project_rules", "domain_events", "automation_rule_executions", "rule_runs", "audit_log", "automation_webhook_deliveries"];
  const result = {};
  for (const name of tables) {
    result[name] = Number((await db.query(`SELECT count(*) AS count FROM ${name}`)).rows[0].count);
  }
  return result;
}

test("rule preview expands selected actions without changing tasks, outbox, history, audit or webhooks", async () => {
  const f = await fixtures("Preview read-only");
  const subject = await task(f.a, "Preview current task");
  const { id } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, {
    name: "Preview stored signing key", definition: definition({ actions: [
      { capability: "webhook.post", params: { url: "http://user:private-password@127.0.0.1:9/hook?token=private-token", secret: "private-signing-key" } },
    ] }),
  });
  const stored = (await request(f.owner, "GET", `/api/projects/${f.a}/rules`, 200)).rules.find((rule) => rule.id === id);
  assert.equal(Object.hasOwn(stored.definition.actions[0].params, "secret"), false);
  const before = await effects();
  const result = await request(f.owner, "POST", preview(f), 200, {
    rule_id: id,
    definition: definition({ actions: [
      { capability: "task.complete", params: {} },
      { capability: "task.create", params: { name: "{{task.name}} / {{project.name}}" } },
      stored.definition.actions[0],
    ] }),
    event: { type: "task.created", task_id: subject },
  });
  assert.equal(result.preview, true);
  assert.equal(result.trace.matched, true);
  assert.equal(result.actions.length, 3);
  assert.match(result.actions[1].params.name, /^Preview current task \/ Preview read-only A$/);
  assert.deepEqual(result.actions[2].params, {});
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.ok(result.warnings.some((warning) => warning.includes("実際")));
  assert.deepEqual(await effects(), before);
  assert.equal((await db.query("SELECT completed FROM tasks WHERE id = $1", [subject])).rows[0].completed, false);
});

test("shared-task preview uses source-project section/custom values and never returns a private project's custom value", async () => {
  const f = await fixtures("Preview shared privacy");
  const { rows: [sourceSection, privateSection] } = await db.query(
    "INSERT INTO sections (project_id, name, position) VALUES ($1, 'Preview source section', 1000), ($2, 'Preview private section', 1000) RETURNING id", [f.a, f.b],
  );
  const shared = await task(f.b, "Preview shared task");
  await db.query("UPDATE tasks SET section_id = $1 WHERE id = $2", [privateSection.id, shared]);
  await db.query("INSERT INTO task_project_memberships (task_id, project_id, section_id) VALUES ($1, $2, $3)", [shared, f.a, sourceSection.id]);
  const { rows: [local, hidden] } = await db.query(
    "INSERT INTO custom_fields (project_id, name, field_type) VALUES ($1, 'Preview local', 'text'), ($2, 'Preview hidden', 'text') RETURNING id", [f.a, f.b],
  );
  const secret = `must-not-leak-${randomUUID()}`;
  await db.query("INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, 'local visible'), ($1, $3, $4)", [shared, local.id, hidden.id, secret]);
  const value = definition({
    conditions: [{ field: "task.section_id", op: "eq", value: String(sourceSection.id) }],
    branches: [
      { name: "no match", conditions: [{ field: "task.name", op: "eq", value: "another task" }], actions: [{ capability: "task.complete" }] },
      { name: "fallback", else: true, conditions: [], actions: [{ capability: "task.create", params: {
        name: `{{custom.${local.id}}}|{{custom.${hidden.id}}}|{{custom.Preview hidden}}`,
      } }] },
    ],
  });
  const result = await request(f.editor, "POST", preview(f), 200, { definition: value, event: { type: "task.created", task_id: shared } });
  assert.equal(result.trace.selected_branch, 1);
  assert.equal(Number(result.trace.conditions[0].actual), Number(sourceSection.id));
  assert.equal(result.trace.branches[0].matched, false);
  assert.equal(result.trace.branches[1].selected, true);
  assert.equal(result.actions[0].params.name, "local visible||");
  assert.ok(!JSON.stringify(result).includes(secret));
  await request(f.editor, "POST", preview(f), 400, {
    definition: definition({ conditions: [{ field: `custom.${hidden.id}`, op: "eq", value: secret }] }),
    event: { type: "task.created", task_id: shared },
  });
});

test("preview requires source edit, scoped task access and ownership of an existing project rule", async () => {
  const f = await fixtures("Preview authorization");
  const sourceTask = await task(f.a, "Preview source task");
  const privateTask = await task(f.b, "Preview private task");
  const { rows: [viewer] } = await db.query("INSERT INTO users (name) VALUES ('Preview viewer') RETURNING id");
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [f.a, viewer.id]);
  const viewerCookie = await session(viewer.id);
  const body = { definition: definition(), event: { type: "task.created", task_id: sourceTask } };
  await request(viewerCookie, "POST", preview(f), 403, body);
  await request(f.editor, "POST", preview(f), 404, { ...body, event: { type: "task.created", task_id: privateTask } });
  const { id } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, { name: "Preview owned rule", definition: definition(), enabled: false });
  await request(f.editor, "POST", preview(f), 403, { ...body, rule_id: id });
  const owned = await request(f.owner, "POST", preview(f), 200, { ...body, rule_id: id });
  assert.ok(owned.warnings.some((warning) => warning.includes("無効")));
  await request(f.owner, "POST", preview(f), 404, { ...body, rule_id: 999999999 });

  const { id: portfolio } = await request(f.owner, "POST", "/api/portfolios", 201, { name: "Preview replica" });
  await request(f.owner, "POST", `/api/portfolios/${portfolio}/projects`, 201, { project_id: f.a });
  const { id: portfolioRule } = await request(f.owner, "POST", `/api/portfolios/${portfolio}/rules`, 201, { name: "Preview hidden replica", definition: definition() });
  const { rows: [replica] } = await db.query("SELECT id FROM project_rules WHERE portfolio_rule_id = $1 AND project_id = $2", [portfolioRule, f.a]);
  await request(f.owner, "POST", preview(f), 404, { ...body, rule_id: Number(replica.id) });
});

test("preview validates explicit event shape/data and can simulate project or webhook events with warnings", async () => {
  const f = await fixtures("Preview mock event");
  const subject = await task(f.a, "Preview event subject");
  for (const event of [undefined, {}, { type: "unknown" }, { type: "task.created" },
    { type: "task.created", task_id: subject, data: [] },
    { type: "task.due_changed", task_id: subject, data: { due_on: "2026-02-30" } },
    { type: "task.assigned", task_id: subject, data: { assignee_id: true } },
    { type: "task.milestone_changed", task_id: subject, data: { is_milestone: "false" } },
    { type: "task.created", task_id: subject, subject_id: 999 },
  ]) await request(f.owner, "POST", preview(f), 400, { definition: definition(), event });
  const sourceOnly = definition({ triggers: [{ event: "project.status_changed" }], actions: [{ capability: "task.create", params: { name: "{{event.data.status}}" } }] });
  const project = await request(f.owner, "POST", preview(f), 200, { definition: sourceOnly, event: { type: "project.status_changed", data: { status: "仮の状態" } } });
  assert.equal(project.actions[0].params.name, "仮の状態");
  const missing = await request(f.owner, "POST", preview(f), 200, { definition: sourceOnly, event: { type: "project.status_changed" } });
  assert.ok(missing.warnings.some((warning) => warning.includes("status")));
  const webhook = await request(f.owner, "POST", preview(f), 200, {
    definition: definition({ triggers: [{ event: "webhook.received" }], actions: [{ capability: "task.create", params: { name: "{{event.data.status}}" } }] }),
    event: { type: "webhook.received", data: { status: 200 } },
  });
  assert.equal(webhook.actions[0].params.name, "200");
});

test("actual run history retains safe evaluation decisions without comparison values or new skipped rows", async () => {
  const f = await fixtures("Preview runtime parity");
  const subject = await task(f.a, "Preview runtime subject");
  const sensitive = `comparison-only-${randomUUID()}`;
  await db.query("UPDATE tasks SET description = $1 WHERE id = $2", [sensitive, subject]);
  const value = definition({ triggers: [{ event: "task.manual_rule" }],
    conditions: [{ field: "task.description", op: "eq", value: sensitive }],
    branches: [
      { name: "no match", conditions: [{ field: "task.name", op: "eq", value: "Other" }], actions: [{ capability: "task.complete" }] },
      { name: "fallback", else: true, conditions: [], actions: [{ capability: "task.add_comment", params: { body: "Actual traced action" } }] },
    ],
  });
  const { id } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, { name: "Preview traced execution", definition: value });
  const dry = await request(f.owner, "POST", preview(f), 200, { rule_id: id, definition: value, event: { type: "task.manual_rule", task_id: subject } });
  const run = await request(f.owner, "POST", `/api/projects/${f.a}/rules/${id}/run`, 201, { task_id: subject });
  assert.equal(run.status, "success");
  const { runs } = await request(f.owner, "GET", `/api/projects/${f.a}/rules/${id}/runs`, 200);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].evaluation.selected_branch, dry.trace.selected_branch);
  assert.equal(runs[0].evaluation.conditions[0].matched, dry.trace.conditions[0].matched);
  assert.equal(Object.hasOwn(runs[0].evaluation.conditions[0], "actual"), false);
  assert.equal(Object.hasOwn(runs[0].evaluation.conditions[0], "value"), false);
  assert.ok(!JSON.stringify(runs[0].evaluation).includes(sensitive));
  const { rows: [checkpoint] } = await db.query("SELECT evaluation FROM automation_rule_executions WHERE event_id = $1 AND rule_id = $2", [run.event_id, id]);
  assert.deepEqual(checkpoint.evaluation, runs[0].evaluation);
  await db.query("UPDATE tasks SET description = 'no longer matches' WHERE id = $1", [subject]);
  const skipped = await request(f.owner, "POST", `/api/projects/${f.a}/rules/${id}/run`, 201, { task_id: subject });
  assert.equal(skipped.status, "skipped");
  assert.equal((await request(f.owner, "GET", `/api/projects/${f.a}/rules/${id}/runs`, 200)).runs.length, 1);
});
