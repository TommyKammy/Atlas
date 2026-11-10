import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(async () => {
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

async function fixture(kind, definition) {
  const current = await fixtures(`AR08 ${kind} ${randomUUID()}`);
  let base = `/api/projects/${current.a}/rules`;
  if (kind === "portfolio") {
    const { id } = await request(current.owner, "POST", "/api/portfolios", 201, { name: "AR08 portfolio" });
    await request(current.owner, "POST", `/api/portfolios/${id}/projects`, 201, { project_id: current.a });
    base = `/api/portfolios/${id}/rules`;
  }
  const { id: ruleId } = await request(current.owner, "POST", base, 201, {
    name: "AR08 original rule", description: "original description", definition,
  });
  const load = async () => (await request(current.owner, "GET", base, 200)).rules.find((rule) => rule.id === ruleId);
  return { ...current, kind, ruleId, base, path: `${base}/${ruleId}`, load };
}

async function processEvents() {
  const response = await http("/api/automation/process?limit=20", {
    method: "POST", timeout: 10_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  assert.equal(response.status, 200, await response.text());
}

async function seedPending(f, name) {
  const { rows: [rule] } = await db.query(
    f.kind === "project"
      ? "SELECT id, version, owner_id, name FROM project_rules WHERE id = $1"
      : "SELECT id, version, owner_id, name FROM project_rules WHERE portfolio_rule_id = $1 AND project_id = $2",
    f.kind === "project" ? [f.ruleId] : [f.ruleId, f.a],
  );
  const subject = await task(f.a, "AR08 pending subject");
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, automation_plan_ready)
     VALUES (1, $1, $2, 'task.manual_rule', 'task', $3, TRUE) RETURNING id`,
    [f.a, f.ownerId, subject],
  );
  await db.query(
    `INSERT INTO automation_rule_executions
       (event_id, rule_id, rule_version, rule_name, owner_id, actions, planned_attempt, event_actor_id, delivery_seed)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1, $5, $7)`,
    [event.id, rule.id, rule.version, rule.name, rule.owner_id, JSON.stringify([
      { capability: "task.create", params: { name, project_id: f.a }, subjectScopeVersion: 1 },
    ]), randomUUID()],
  );
  return { eventId: event.id, executionRuleId: rule.id };
}

for (const kind of ["project", "portfolio"]) {
  test(`AR08 ${kind}: metadata/unchanged definition preserve pending work and stale editors get 409`, async () => {
    const resultName = `AR08 resumed ${randomUUID()}`;
    const f = await fixture(kind, {
      triggers: [{ event: "task.manual_rule" }],
      actions: [{ capability: "task.create", params: { name: resultName } }],
    });
    const original = await f.load();
    const pending = await seedPending(f, resultName);

    // Both tabs loaded this exact timestamp. A metadata edit must invalidate
    // the other tab without invalidating the queued execution definition.
    await request(f.owner, "PATCH", f.path, 200, {
      description: "first tab description", expected_updated_at: original.updated_at,
    });
    const metadata = await f.load();
    assert.equal(metadata.version, original.version);
    assert.notEqual(metadata.updated_at, original.updated_at);
    await request(f.owner, "PATCH", f.path, 409, {
      name: "stale tab overwrite", expected_updated_at: original.updated_at,
    });
    await request(f.owner, "PATCH", f.path, 200, {
      name: "current tab name", description: metadata.description,
      definition: metadata.definition, webhookActionIds: true,
      expected_updated_at: metadata.updated_at,
    });
    const unchanged = await f.load();
    assert.equal(unchanged.version, original.version);
    assert.equal(unchanged.name, "current tab name");
    assert.equal(unchanged.description, "first tab description");
    await processEvents();
    assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = $2", [f.a, resultName])).rowCount, 1);
    const { rows: [run] } = await db.query(
      "SELECT status, rule_version FROM rule_runs WHERE event_id = $1 AND rule_id = $2", [pending.eventId, pending.executionRuleId],
    );
    assert.equal(run?.status, "success");
    assert.equal(Number(run?.rule_version), original.version);

    const changedDefinition = structuredClone(unchanged.definition);
    changedDefinition.actions[0].params.name = `${resultName} changed`;
    await request(f.owner, "PATCH", f.path, 200, {
      definition: changedDefinition, expected_updated_at: unchanged.updated_at,
    });
    assert.equal((await f.load()).version, original.version + 1);
    // Older API callers retain compatibility while the server still protects
    // the read/authorization/write window using its loaded revision.
    await request(f.owner, "PATCH", f.path, 200, { description: "legacy caller" });
    assert.equal((await f.load()).version, original.version + 1);
  });

  test(`AR08 ${kind}: stale webhook references cannot undo a concurrent signing-key rotation`, async () => {
    const f = await fixture(kind, {
      triggers: [{ event: "task.manual_rule" }],
      actions: [{ capability: "webhook.post", params: { url: "https://example.com/atlas-ar08", secret: "AR08 original key" } }],
    });
    const original = await f.load();
    const rotated = structuredClone(original.definition);
    rotated.actions[0].params.secret = "AR08 rotated key";
    await request(f.owner, "PATCH", f.path, 200, {
      definition: rotated, webhookActionIds: true, expected_updated_at: original.updated_at,
    });
    await request(f.owner, "PATCH", f.path, 409, {
      definition: original.definition, webhookActionIds: true, expected_updated_at: original.updated_at,
    });
    const current = await f.load();
    await request(f.owner, "PATCH", f.path, 200, {
      definition: current.definition, webhookActionIds: true, expected_updated_at: current.updated_at,
    });
    assert.equal((await f.load()).version, current.version, "retaining a secret is an unchanged definition");
    const table = kind === "project" ? "project_rules" : "portfolio_rules";
    const { rows: [stored] } = await db.query(`SELECT definition FROM ${table} WHERE id = $1`, [f.ruleId]);
    assert.equal(stored.definition.actions[0].params.secret, "AR08 rotated key");
    if (kind === "portfolio") {
      const { rows: replicas } = await db.query("SELECT definition, version FROM project_rules WHERE portfolio_rule_id = $1", [f.ruleId]);
      assert.equal(replicas.length, 1);
      assert.equal(replicas[0].definition.actions[0].params.secret, "AR08 rotated key");
      assert.equal(Number(replicas[0].version), current.version);
    }
  });
}
