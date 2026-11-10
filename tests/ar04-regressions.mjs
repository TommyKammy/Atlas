import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function createRule(owner, projectId, name, event, actions) {
  return (await request(owner, "POST", `/api/projects/${projectId}/rules`, 201, {
    name, definition: { triggers: [{ event }], actions },
  })).id;
}

async function enqueue(projectId, actorId, taskId, type) {
  const { rows: [row] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id)
     VALUES (1, $1, $2, $3, 'task', $4) RETURNING id`,
    [projectId, actorId, type, taskId],
  );
  return Number(row.id);
}

async function processEvents(limit = 100) {
  const response = await http(`/api/automation/process?limit=${limit}`, {
    method: "POST", timeout: 25_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
}

async function drain(projectId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await Promise.all([processEvents(), processEvents()]);
    const { rows: [{ n }] } = await db.query(
      "SELECT count(*)::int AS n FROM domain_events WHERE project_id = $1 AND processed_at IS NULL AND failed_at IS NULL",
      [projectId],
    );
    if (n === 0) return;
  }
  assert.fail("The automation fixture did not reach a terminal state");
}

const createTask = (name) => ({ capability: "task.create", params: { name } });
const addComment = (body) => ({ capability: "task.add_comment", params: { body } });

test("AR04 a task-created rule cannot multiply its own descendants", { timeout: 30_000 }, async () => {
  const { a, owner, ownerId } = await fixtures("AR04 self fan-out");
  const subject = await task(a, "Root");
  const ruleId = await createRule(owner, a, "Create two children", "task.created", [
    createTask("AR04 child one"), createTask("AR04 child two"),
  ]);
  await enqueue(a, ownerId, subject, "task.created");
  await drain(a);
  const { rows } = await db.query("SELECT name FROM tasks WHERE project_id = $1 ORDER BY id", [a]);
  assert.deepEqual(rows.map(({ name }) => name), ["Root", "AR04 child one", "AR04 child two"]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rule_runs WHERE rule_id = $1", [ruleId])).rows[0].n, 1);
});

test("AR04 distinct rules can chain and a later event cannot re-enter an ancestor rule", { timeout: 30_000 }, async () => {
  const { a, owner, ownerId } = await fixtures("AR04 causal cycle");
  const subject = await task(a, "Chained task");
  const first = await createRule(owner, a, "Status to comment", "task.status_changed", [addComment("AR04 once")]);
  const second = await createRule(owner, a, "Comment to status", "comment.created", [
    { capability: "task.set_status", params: { status: "AR04 done" } },
  ]);
  await enqueue(a, ownerId, subject, "task.status_changed");
  await drain(a);
  assert.equal((await db.query("SELECT status FROM tasks WHERE id = $1", [subject])).rows[0].status, "AR04 done");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM comments WHERE task_id = $1", [subject])).rows[0].n, 1);
  const { rows } = await db.query(
    "SELECT rule_id, count(*)::int AS n FROM rule_runs WHERE rule_id = ANY($1::bigint[]) GROUP BY rule_id ORDER BY rule_id",
    [[first, second]],
  );
  assert.deepEqual(rows.map(({ rule_id, n }) => [Number(rule_id), n]), [[first, 1], [second, 1]]);
});

test("AR04 unchanged task actions preserve timestamps and emit no change events", { timeout: 30_000 }, async () => {
  const { a, b, owner, ownerId } = await fixtures("AR04 no changes");
  const subject = await task(a, "Unchanged");
  const { rows: [section] } = await db.query(
    "INSERT INTO sections (project_id, name) VALUES ($1, 'Current') RETURNING id", [a],
  );
  await db.query(
    "UPDATE tasks SET assignee_id = $2, status = 'AR04 same', due_on = '2042-01-01', section_id = $3 WHERE id = $1",
    [subject, ownerId, section.id],
  );
  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [subject, b]);
  const { rows: [before] } = await db.query("SELECT updated_at::text FROM tasks WHERE id = $1", [subject]);
  await createRule(owner, a, "No-op actions", "task.manual_rule", [
    { capability: "task.assign", params: { user_id: ownerId } },
    { capability: "task.set_status", params: { status: "AR04 same" } },
    { capability: "task.set_due_date", params: { due_on: "2042-01-01" } },
    { capability: "task.move_section", params: { section_id: Number(section.id) } },
    { capability: "task.add_to_project", params: { project_id: b } },
    { capability: "task.add_to_project", params: { project_id: a } },
  ]);
  await enqueue(a, ownerId, subject, "task.manual_rule");
  await drain(a);
  assert.equal((await db.query("SELECT updated_at::text FROM tasks WHERE id = $1", [subject])).rows[0].updated_at, before.updated_at);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM task_events WHERE task_id = $1", [subject])).rows[0].n, 0);
  const { rows } = await db.query("SELECT type FROM domain_events WHERE project_id = $1 ORDER BY id", [a]);
  assert.deepEqual(rows.map(({ type }) => type), ["task.manual_rule"]);
});

test("AR04 concurrent descendants share one 150-action budget and independent roots get their own budget", { timeout: 60_000 }, async () => {
  const { a, owner, ownerId } = await fixtures("AR04 shared budget");
  const subject = await task(a, "Budget root");
  await createRule(owner, a, "Root fan-out", "task.manual_rule",
    Array.from({ length: 20 }, (_, i) => createTask(`AR04 budget child ${i}`)));
  for (let i = 0; i < 9; i++) {
    await createRule(owner, a, `Child rule ${i}`, "task.created", [addComment(`AR04 budget ${i}`)]);
  }
  for (const expectedComments of [130, 260]) {
    const root = await enqueue(a, ownerId, subject, "task.manual_rule");
    await drain(a);
    assert.equal((await db.query("SELECT automation_actions_started FROM domain_events WHERE id = $1", [root])).rows[0].automation_actions_started, 150);
    assert.equal((await db.query(
      "SELECT count(*)::int AS n FROM comments c JOIN tasks t ON t.id = c.task_id WHERE t.project_id = $1", [a],
    )).rows[0].n, expectedComments);
    assert.ok((await db.query(
      "SELECT 1 FROM domain_events WHERE automation_root_event_id = $1 AND last_error = 'automation causal action limit exceeded'",
      [root],
    )).rowCount > 0);
  }
});

test("AR04 action reservations survive transient failure and expired-lease reclaim", { timeout: 30_000 }, async (t) => {
  const { a, owner, ownerId } = await fixtures("AR04 resumed budget");
  const subject = await task(a, "Retry root");
  const first = "AR04 committed";
  const second = "AR04 retry target";
  await createRule(owner, a, "Retry without another reservation", "task.manual_rule", [createTask(first), createTask(second)]);
  const name = `ar04_${randomUUID().replaceAll("-", "")}`;
  await db.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name = 'AR04 retry target' THEN
        RAISE EXCEPTION 'temporary AR04 failure' USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION ${name}();
  `);
  t.after(() => db.query(`DROP TRIGGER IF EXISTS ${name} ON tasks; DROP FUNCTION IF EXISTS ${name}()`));
  const root = await enqueue(a, ownerId, subject, "task.manual_rule");
  await processEvents(1);
  assert.equal((await db.query("SELECT automation_actions_started FROM domain_events WHERE id = $1", [root])).rows[0].automation_actions_started, 2);
  await db.query(`DROP TRIGGER ${name} ON tasks`);
  await db.query(
    `UPDATE domain_events SET retry_at = now() - interval '1 second', claim_token = $2::uuid,
       lease_expires_at = now() - interval '1 second' WHERE id = $1`,
    [root, randomUUID()],
  );
  await drain(a);
  const { rows: [finished] } = await db.query(
    "SELECT processed_at, failed_at, automation_actions_started FROM domain_events WHERE id = $1", [root],
  );
  assert.ok(finished.processed_at);
  assert.equal(finished.failed_at, null);
  assert.equal(finished.automation_actions_started, 2);
  const { rows } = await db.query(
    "SELECT name FROM tasks WHERE project_id = $1 AND name = ANY($2::text[]) ORDER BY id", [a, [first, second]],
  );
  assert.deepEqual(rows.map(({ name }) => name), [first, second]);
});
