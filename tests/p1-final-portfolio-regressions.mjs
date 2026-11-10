import assert from "node:assert/strict";
import { test } from "node:test";
import { db, fixtures, http, request, waitForHttp } from "./regression-fixtures.mjs";

async function portfolioFixture(label) {
  await waitForHttp();
  const { a, b, owner: admin, ownerId: adminId, editor: portfolioOwner, editorId: portfolioOwnerId } =
    await fixtures(label);
  await db.query("UPDATE users SET is_admin = TRUE WHERE id = $1", [adminId]);
  await db.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')",
    [b, portfolioOwnerId],
  );
  const { id: portfolioId } = await request(portfolioOwner, "POST", "/api/portfolios", 201, { name: label });
  const portfolio = `/api/portfolios/${portfolioId}`;
  await request(portfolioOwner, "POST", `${portfolio}/projects`, 201, { project_id: a });
  const { id: ruleId } = await request(admin, "POST", `${portfolio}/rules`, 201, {
    name: "Auto-complete newly created tasks",
    definition: {
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "task.complete", params: {} }],
    },
  });
  return { a, b, admin, adminId, portfolioOwner, portfolioOwnerId, portfolioId, portfolio, ruleId };
}

async function projectReplica(projectId, ruleId) {
  const { rows: [row] } = await db.query(
    "SELECT id, owner_id, enabled FROM project_rules WHERE project_id = $1 AND portfolio_rule_id = $2",
    [projectId, ruleId],
  );
  return row;
}

async function processQueue() {
  const response = await http("/api/automation/process?limit=100", {
    method: "POST",
    headers: { "x-automation-token": "atlas-regression-worker" },
    timeout: 10_000,
  });
  assert.equal(response.status, 200, await response.text());
}

test("R01 portfolio viewers cannot install another owner's active rule on a project", { timeout: 30_000 }, async () => {
  const { b, admin, adminId, portfolioOwner, portfolioOwnerId, portfolioId, portfolio, ruleId } =
    await portfolioFixture("R01 portfolio rule scope");
  const projects = `${portfolio}/projects`;

  await request(portfolioOwner, "POST", projects, 403, { project_id: b });
  assert.equal(await projectReplica(b, ruleId), undefined);
  const items = await db.query(
    "SELECT 1 FROM portfolio_items WHERE portfolio_id = $1 AND project_id = $2",
    [portfolioId, b],
  );
  assert.equal(items.rowCount, 0);
  const { id: unaffected } = await request(admin, "POST", "/api/tasks", 201, {
    project_id: b, name: "Unaffected without a replica",
  });
  await request(portfolioOwner, "PATCH", `/api/tasks/${unaffected}`, 403, { completed: true });
  await processQueue();
  assert.equal((await db.query("SELECT completed FROM tasks WHERE id = $1", [unaffected])).rows[0].completed, false);

  await db.query("UPDATE project_members SET role = 'editor' WHERE project_id = $1 AND user_id = $2", [
    b, portfolioOwnerId,
  ]);
  await request(portfolioOwner, "POST", projects, 201, { project_id: b });
  const replica = await projectReplica(b, ruleId);
  assert.equal(replica.owner_id, adminId);
  assert.equal(replica.enabled, true);
  const { id: target } = await request(admin, "POST", "/api/tasks", 201, {
    project_id: b, name: "Completed by the installed rule",
  });
  await processQueue();
  assert.equal((await db.query("SELECT completed FROM tasks WHERE id = $1", [target])).rows[0].completed, true);
});

test("R01 portfolio viewers can add a project with disabled rules without acquiring activation rights", { timeout: 25_000 }, async () => {
  const { b, admin, portfolioOwner, portfolio, ruleId } = await portfolioFixture("R01 portfolio rule activation");
  const rule = `${portfolio}/rules/${ruleId}`;
  await request(admin, "PATCH", rule, 200, { enabled: false });
  await request(portfolioOwner, "POST", `${portfolio}/projects`, 201, { project_id: b });
  const installed = await projectReplica(b, ruleId);
  assert.equal(installed.enabled, false);
  await request(portfolioOwner, "PATCH", rule, 403, { enabled: true });
  await request(admin, "PATCH", rule, 200, { enabled: true });
  assert.equal((await projectReplica(b, ruleId)).enabled, true);

  await request(portfolioOwner, "POST", `${portfolio}/projects`, 201, { project_id: b });
  assert.equal((await projectReplica(b, ruleId)).id, installed.id);
});
