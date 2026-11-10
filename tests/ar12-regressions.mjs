import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(async () => {
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

const definition = (extra = {}) => ({
  triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.complete", params: {} }], ...extra,
});

async function fixture(kind) {
  const f = await fixtures(`AR12 ${kind}`);
  let base = `/api/projects/${f.a}/rules`;
  let portfolioId;
  if (kind === "portfolio") {
    ({ id: portfolioId } = await request(f.owner, "POST", "/api/portfolios", 201, { name: "AR12 disabled portfolio rule" }));
    await request(f.owner, "POST", `/api/portfolios/${portfolioId}/projects`, 201, { project_id: f.a });
    base = `/api/portfolios/${portfolioId}/rules`;
  }
  return { ...f, base, portfolioId, load: async () => (await request(f.owner, "GET", base, 200)).rules };
}

async function processEvents() {
  const response = await http("/api/automation/process?limit=20", {
    method: "POST", timeout: 10_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  assert.equal(response.status, 200, await response.text());
}

for (const kind of ["project", "portfolio"]) {
  test(`AR12 ${kind}: malformed collections, condition types and enabled flags reject without changing the stored rule`, async () => {
    const f = await fixture(kind);
    const { id } = await request(f.owner, "POST", f.base, 201, { name: "AR12 intact rule", definition: definition() });
    const original = (await f.load()).find((rule) => rule.id === id);
    const { rows: [budget, privateBudget, people] } = await db.query(
      `INSERT INTO custom_fields (project_id, name, field_type)
       VALUES ($1, 'AR12 Budget', 'number'), ($2, 'AR12 Foreign Budget', 'number'), ($1, 'AR12 Reviewers', 'people') RETURNING id`,
      [f.a, f.b],
    );
    const invalid = [
      definition({ conditions: {} }), definition({ conditions: null }), definition({ triggers: "task.manual_rule" }),
      definition({ actions: {} }), definition({ branches: false }),
      definition({ branches: [{ conditions: {}, actions: [{ capability: "task.complete" }] }] }),
      definition({ branches: [{ conditions: [], actions: [{ capability: "task.complete" }], else: "false" }] }),
      definition({ conditions: [{ field: "task.nonexistent", op: "eq", value: "x" }] }),
      definition({ conditions: [{ field: "task.completed", op: "contains", value: "true" }] }),
      definition({ conditions: [{ field: "task.progress", op: "gt", value: "not numeric" }] }),
      definition({ conditions: [{ field: "task.due_on", op: "eq", value: "2026-02-30" }] }),
      definition({ conditions: [{ field: `custom.${privateBudget.id}`, op: "eq", value: "1" }] }),
      definition({ conditions: [{ field: `custom.${budget.id}`, op: "gt", value: "not numeric" }] }),
      definition({ branches: [{ name: "bad custom branch", conditions: [{ field: `custom.${people.id}`, op: "contains", value: "not an ID" }], actions: [{ capability: "task.complete" }] }] }),
    ];
    for (const value of invalid) {
      await request(f.owner, "POST", f.base, 400, { name: "AR12 rejected", definition: value });
      await request(f.owner, "PATCH", `${f.base}/${id}`, 400, { definition: value });
    }
    for (const enabled of ["false", 0, null, {}]) {
      await request(f.owner, "POST", f.base, 400, { name: "AR12 rejected enabled", definition: definition(), enabled });
      await request(f.owner, "PATCH", `${f.base}/${id}`, 400, { enabled });
    }
    assert.equal((await f.load()).length, 1);
    const after = (await f.load())[0];
    assert.deepEqual(after.definition, original.definition);
    assert.equal(after.version, original.version);
    assert.equal(after.updated_at, original.updated_at);
    // Legacy snapshot fields, field names, action templates and explicit clears remain valid.
    await request(f.owner, "POST", f.base, 201, { name: "AR12 compatible rule", enabled: false, definition: definition({
      conditions: [
        { field: "task.created_by", op: "eq", value: String(f.ownerId) },
        { field: "event.data.external.status", op: "eq", value: "approved" },
        { field: "custom.AR12 Budget", op: "gte", value: "1.5" },
      ],
      actions: [
        { capability: "task.add_comment", params: { body: "{{task.name}} {{event.data.external.status}}" } },
        { capability: "task.set_custom_field", params: { field_id: Number(budget.id), value: null } },
        { capability: "task.set_custom_field", params: { field_id: Number(people.id), value: [] } },
      ],
    }) });
  });

  test(`AR12 ${kind}: enabled false is stored and never executes until enabled`, async () => {
    const f = await fixture(kind);
    const { id } = await request(f.owner, "POST", f.base, 201, {
      name: "AR12 initially disabled", definition: definition(), enabled: false,
    });
    assert.equal((await f.load()).find((rule) => rule.id === id).enabled, false);
    let executionRuleId = id;
    if (kind === "portfolio") {
      // A later-added project must inherit the same disabled state as initial replicas.
      await request(f.owner, "POST", `/api/portfolios/${f.portfolioId}/projects`, 201, { project_id: f.b });
      const { rows } = await db.query("SELECT id, project_id, enabled FROM project_rules WHERE portfolio_rule_id = $1", [id]);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.enabled === false));
      executionRuleId = Number(rows.find((row) => Number(row.project_id) === f.a).id);
    }
    const subject = await task(f.a, "AR12 disabled rule subject");
    const enqueue = () => db.query(
      `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, data)
       VALUES (1, $1, $2, 'task.manual_rule', 'task', $3, jsonb_build_object('target_rule_id', $4::bigint)) RETURNING id`,
      [f.a, f.ownerId, subject, executionRuleId],
    );
    const { rows: [first] } = await enqueue();
    await processEvents();
    assert.equal((await db.query("SELECT completed FROM tasks WHERE id = $1", [subject])).rows[0].completed, false);
    assert.equal((await db.query("SELECT id FROM rule_runs WHERE event_id = $1", [first.id])).rowCount, 0);

    await request(f.owner, "PATCH", `${f.base}/${id}`, 200, { enabled: true });
    assert.equal((await f.load()).find((rule) => rule.id === id).enabled, true);
    const { rows: [second] } = await enqueue();
    await processEvents();
    assert.equal((await db.query("SELECT completed FROM tasks WHERE id = $1", [subject])).rows[0].completed, true);
    assert.equal((await db.query("SELECT status FROM rule_runs WHERE event_id = $1", [second.id])).rows[0]?.status, "success");
  });
}
