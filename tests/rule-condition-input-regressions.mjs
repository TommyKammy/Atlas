import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, request, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

const condition = (value, op = "eq", field = "task.name") => ({ field, op, value });
const definition = (conditions = []) => ({
  version: 1,
  triggers: [{ event: "task.completed" }],
  conditions,
  actions: [{ capability: "task.set_status", params: { status: "完了" } }],
});
const rules = (project) => `/api/projects/${project}/rules`;
const drafts = (project) => `${rules(project)}/drafts`;

async function live(project, rule) {
  return (await db.query(
    `SELECT id, name, definition, enabled, version, updated_at::text
     FROM project_rules WHERE project_id = $1 AND id = $2`,
    [project, rule],
  )).rows[0];
}

async function countRules(project) {
  return (await db.query("SELECT count(*)::int AS count FROM project_rules WHERE project_id = $1", [project])).rows[0].count;
}

const missingConditions = [
  condition(undefined),
  condition(null),
  condition(""),
  condition(" \t\n　"),
  condition("", "neq"),
  condition("", "contains"),
  condition("  ", "not_contains"),
  condition([], "in"),
  condition([], "not_in"),
  condition(["Ready", ""], "in"),
  condition(["Ready", null], "not_in"),
  condition(undefined, "gt", "task.progress"),
  condition("  ", "gte", "task.progress"),
  condition("", "lt", "task.due_on"),
];

test("rule creation rejects unfilled condition values without creating a live rule", async () => {
  const f = await fixtures("Condition input create");
  for (const [index, entry] of missingConditions.entries()) {
    const rejected = await request(f.owner, "POST", rules(f.a), 400, {
      name: `Incomplete condition ${index}`, definition: definition([entry]),
    });
    assert.equal(typeof rejected.error, "string");
    assert.ok(rejected.error.trim(), "a rejected condition must explain the problem");
    assert.equal(await countRules(f.a), 0, JSON.stringify(entry));
  }
});

test("rule publication validates every branch even when another branch is valid", async () => {
  const f = await fixtures("Condition input branches");
  for (const entry of [condition(""), condition([], "in"), condition(["Ready", " "], "not_in")]) {
    await request(f.owner, "POST", rules(f.a), 400, {
      name: "An incomplete second branch",
      definition: {
        version: 1, triggers: [{ event: "task.completed" }],
        branches: [
          { name: "Valid first branch", conditions: [condition("Ready")], actions: definition().actions },
          { name: "Incomplete second branch", conditions: [entry], actions: definition().actions },
        ],
      },
    });
    assert.equal(await countRules(f.a), 0);
  }
});

test("invalid condition updates leave the published rule contents and version unchanged", async () => {
  const f = await fixtures("Condition input update");
  const { id } = await request(f.owner, "POST", rules(f.a), 201, {
    name: "Published complete condition", definition: definition([condition("Ready")]), enabled: false,
  });
  const before = await live(f.a, id);
  for (const entry of missingConditions) {
    await request(f.owner, "PATCH", `${rules(f.a)}/${id}`, 400, {
      name: "Must not replace the published name", enabled: true,
      expected_updated_at: before.updated_at, definition: definition([entry]),
    });
    assert.deepEqual(await live(f.a, id), before);
  }
});

test("incomplete conditions can be saved as drafts but cannot publish until the same draft is corrected", async () => {
  const f = await fixtures("Condition input draft");
  const { id } = await request(f.owner, "POST", rules(f.a), 201, {
    name: "Published safe rule", definition: definition([condition("Ready")]), enabled: false,
  });
  const before = await live(f.a, id);
  let { draft } = await request(f.owner, "POST", drafts(f.a), 201, { rule_id: id });
  const draftId = draft.id;
  for (const value of ["", "  ", null]) {
    ({ draft } = await request(f.owner, "PUT", `${drafts(f.a)}/${draftId}`, 200, {
      expected_revision: draft.revision, name: "Incomplete work stays private",
      definition: definition([condition(value)]), enabled: true,
    }));
    const restored = (await request(f.owner, "GET", `${drafts(f.a)}/${draftId}`, 200)).draft;
    assert.equal(restored.definition.conditions[0].value, value);
    assert.equal(restored.revision, draft.revision);
    await request(f.owner, "POST", `${drafts(f.a)}/${draftId}/publish`, 400, {
      expected_revision: draft.revision,
    });
    const rejected = (await request(f.owner, "GET", `${drafts(f.a)}/${draftId}`, 200)).draft;
    assert.equal(rejected.id, draftId);
    assert.equal(rejected.revision, draft.revision, "a failed publication must not consume the draft revision");
    assert.deepEqual(await live(f.a, id), before);
  }
  ({ draft } = await request(f.owner, "PUT", `${drafts(f.a)}/${draftId}`, 200, {
    expected_revision: draft.revision, definition: definition([condition("Repaired")]),
  }));
  const published = await request(f.owner, "POST", `${drafts(f.a)}/${draftId}/publish`, 200, {
    expected_revision: draft.revision,
  });
  assert.equal(published.draft.id, draftId);
  assert.equal(published.rule_id, id);
  const after = await live(f.a, id);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.enabled, true);
  assert.equal(after.definition.conditions[0].value, "Repaired");
});

test("explicit empty checks, zero, false and workflows without conditions remain publishable", async () => {
  const f = await fixtures("Condition input valid values");
  for (const [index, conditions] of [
    [],
    [{ field: "task.name", op: "is_empty" }],
    [{ field: "task.description", op: "is_not_empty" }],
    [condition(0, "eq", "task.progress")],
    [condition(false, "eq", "task.completed")],
    [condition(["Ready", "In progress"], "in")],
  ].entries()) {
    const { id } = await request(f.owner, "POST", rules(f.a), 201, {
      name: `Explicit valid condition ${index}`, definition: definition(conditions), enabled: false,
    });
    assert.deepEqual((await live(f.a, id)).definition.conditions, conditions);
  }
  assert.equal(await countRules(f.a), 6);
});

test("enabling a legacy rule revalidates its stored conditions before changing live state", async () => {
  const f = await fixtures("Condition input legacy enable");
  const { rows: [inserted] } = await db.query(
    `INSERT INTO project_rules (workspace_id, project_id, owner_id, name, definition, enabled)
     VALUES (1, $1, $2, 'Legacy incomplete condition', $3::jsonb, false) RETURNING id`,
    [f.a, f.ownerId, JSON.stringify(definition([condition("")]))],
  );
  const id = Number(inserted.id);
  const before = await live(f.a, id);
  await request(f.owner, "PATCH", `${rules(f.a)}/${id}`, 400, { enabled: true });
  assert.deepEqual(await live(f.a, id), before);
  await request(f.owner, "PATCH", `${rules(f.a)}/${id}`, 200, {
    definition: definition([{ field: "task.name", op: "is_not_empty" }]), enabled: true,
  });
  assert.equal((await live(f.a, id)).enabled, true);
});

test("portfolio creation, update and legacy enabling reject incomplete conditions before propagating replicas", async () => {
  const f = await fixtures("Condition input portfolio");
  const { rows: [portfolio] } = await db.query(
    "INSERT INTO portfolios (workspace_id, owner_id, name) VALUES (1, $1, 'Condition input portfolio') RETURNING id",
    [f.ownerId],
  );
  await db.query("INSERT INTO portfolio_items (portfolio_id, project_id) VALUES ($1, $2)", [portfolio.id, f.a]);
  const base = `/api/portfolios/${portfolio.id}/rules`;
  await request(f.owner, "POST", base, 400, {
    name: "Incomplete portfolio condition", definition: definition([condition("")]),
  });
  assert.equal((await db.query("SELECT count(*)::int AS count FROM portfolio_rules WHERE portfolio_id = $1", [portfolio.id])).rows[0].count, 0);
  assert.equal(await countRules(f.a), 0);

  const { id } = await request(f.owner, "POST", base, 201, {
    name: "Published portfolio condition", definition: definition([condition("Ready")]), enabled: false,
  });
  const loadPortfolio = async (rule) => (await db.query(
    "SELECT id, name, definition, enabled, version, updated_at::text FROM portfolio_rules WHERE id = $1 AND portfolio_id = $2",
    [rule, portfolio.id],
  )).rows[0];
  const loadReplicas = async (rule) => (await db.query(
    "SELECT id, definition, enabled, version, updated_at::text FROM project_rules WHERE portfolio_rule_id = $1 ORDER BY id", [rule],
  )).rows;
  const before = await loadPortfolio(id);
  const replicas = await loadReplicas(id);
  assert.equal(replicas.length, 1);
  await request(f.owner, "PATCH", `${base}/${id}`, 400, {
    definition: definition([condition(["Ready", ""], "in")]), enabled: true,
  });
  assert.deepEqual(await loadPortfolio(id), before);
  assert.deepEqual(await loadReplicas(id), replicas);

  // Reproduce a definition written before publication validation was added.
  const legacy = definition([condition(" ")]);
  await db.query("UPDATE portfolio_rules SET definition = $2::jsonb WHERE id = $1", [id, JSON.stringify(legacy)]);
  await db.query("UPDATE project_rules SET definition = $2::jsonb WHERE portfolio_rule_id = $1", [id, JSON.stringify(legacy)]);
  const legacyBefore = await loadPortfolio(id);
  const legacyReplicas = await loadReplicas(id);
  await request(f.owner, "PATCH", `${base}/${id}`, 400, { enabled: true });
  assert.deepEqual(await loadPortfolio(id), legacyBefore);
  assert.deepEqual(await loadReplicas(id), legacyReplicas);
});
