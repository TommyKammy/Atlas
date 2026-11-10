import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

test("AR09 project rule APIs reject known portfolio replica IDs for editors and viewers", { timeout: 25_000 }, async () => {
  const { a, owner, ownerId, editor } = await fixtures("AR09 rule scope");
  const { rows: [viewer] } = await db.query("INSERT INTO users (name) VALUES ('AR09 viewer') RETURNING id");
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,'viewer')", [a, viewer.id]);
  const viewerCookie = await session(viewer.id);
  const subject = await task(a, "AR09 task");
  const { id: portfolioId } = await request(owner, "POST", "/api/portfolios", 201, { name: "AR09 portfolio" });
  const portfolio = `/api/portfolios/${portfolioId}`;
  await request(owner, "POST", `${portfolio}/projects`, 201, { project_id: a });
  const { id: portfolioRuleId } = await request(owner, "POST", `${portfolio}/rules`, 201, {
    name: "AR09 hidden manual rule",
    definition: { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.add_comment", params: { body: "AR09 hidden effect" } }] },
  });
  const { rows: [replica] } = await db.query("SELECT id FROM project_rules WHERE project_id=$1 AND portfolio_rule_id=$2", [a, portfolioRuleId]);
  assert.ok(replica);
  await db.query(
    `INSERT INTO rule_runs (rule_id, rule_name, rule_version, owner_id, source, status, details)
     VALUES ($1, 'AR09 hidden history', 1, $2, 'automation', 'success', '[]')`, [replica.id, ownerId],
  );
  const projectRules = `/api/projects/${a}/rules`;
  for (const cookie of [editor, viewerCookie]) {
    const listed = await request(cookie, "GET", projectRules, 200);
    assert.ok(!listed.rules.some((rule) => rule.id === Number(replica.id)));
    await request(cookie, "GET", `${projectRules}/${replica.id}/runs`, 404);
  }
  await request(editor, "POST", `${projectRules}/${replica.id}/run`, 404, { task_id: subject });
  await request(viewerCookie, "POST", `${projectRules}/${replica.id}/run`, 403, { task_id: subject });
  const emitted = await db.query("SELECT id FROM domain_events WHERE type='task.manual_rule' AND data->>'target_rule_id'=$1", [String(replica.id)]);
  assert.equal(emitted.rowCount, 0);

  const { id: localId } = await request(owner, "POST", projectRules, 201, {
    name: "AR09 visible project rule",
    definition: { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.add_comment", params: { body: "AR09 allowed effect" } }] },
  });
  const response = await http(`${projectRules}/${localId}/run`, { cookie: editor, method: "POST", json: { task_id: subject } });
  assert.ok([200, 201, 202].includes(response.status), await response.text());
  for (const cookie of [editor, viewerCookie]) {
    const history = await request(cookie, "GET", `${projectRules}/${localId}/runs`, 200);
    assert.ok(Array.isArray(history.runs));
  }
  const portfolioHistory = await request(owner, "GET", `${portfolio}/rules/${portfolioRuleId}/runs`, 200);
  assert.ok(portfolioHistory.runs.some((run) => run.rule_name === "AR09 hidden history"));
});
