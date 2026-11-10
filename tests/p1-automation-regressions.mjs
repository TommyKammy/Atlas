import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function seedRule(name, actions) {
  // Other suites leave outbox fixtures behind with automatic polling disabled.
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
  const { a, owner, ownerId } = await fixtures(name);
  const subject = await task(a, "Automation trigger");
  const { id: ruleId } = await request(owner, "POST", `/api/projects/${a}/rules`, 201, {
    name, definition: { triggers: [{ event: "task.manual_rule" }], actions },
  });
  const { rows: [{ id: eventId }] } = await db.query(
    `INSERT INTO domain_events (workspace_id, project_id, actor_id, type, subject_type, subject_id, data)
     VALUES (1, $1, $2, 'task.manual_rule', 'task', $3, jsonb_build_object('target_rule_id', $4::bigint)) RETURNING id`,
    [a, ownerId, subject, ruleId],
  );
  return { a, ruleId, eventId };
}

async function processOne() {
  const response = await http("/api/automation/process?limit=1", {
    method: "POST", timeout: 10_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

const createTask = (name, params = {}) => ({ capability: "task.create", params: { name, ...params } });

test("R14 a retried event resumes from the committed action and an active lease cannot be stolen", { timeout: 20_000 }, async (t) => {
  const first = "R14 committed first effect";
  const second = "R14 retryable second effect";
  const { a, eventId, ruleId } = await seedRule("Resumable automation", [createTask(first), createTask(second)]);
  await db.query(`
    CREATE FUNCTION regression_fail_second_action() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name = 'R14 retryable second effect' THEN
        RAISE EXCEPTION 'fixture temporarily unavailable' USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER regression_fail_second_action BEFORE INSERT ON tasks
      FOR EACH ROW EXECUTE FUNCTION regression_fail_second_action();
  `);
  t.after(() => db.query("DROP TRIGGER IF EXISTS regression_fail_second_action ON tasks; DROP FUNCTION IF EXISTS regression_fail_second_action()"));

  async function effects() {
    const { rows } = await db.query("SELECT name FROM tasks WHERE project_id = $1 AND name = ANY($2::text[]) ORDER BY id", [a, [first, second]]);
    return rows.map(({ name }) => name);
  }

  await processOne();
  assert.deepEqual(await effects(), [first]);
  const { rows: [pending] } = await db.query("SELECT processed_at, failed_at FROM domain_events WHERE id = $1", [eventId]);
  assert.deepEqual(pending, { processed_at: null, failed_at: null });
  const { rows: [progress] } = await db.query(
    "SELECT next_action FROM automation_rule_executions WHERE event_id = $1 AND rule_id = $2", [eventId, ruleId],
  );
  assert.equal(progress?.next_action, 1);

  await db.query("DROP TRIGGER regression_fail_second_action ON tasks");
  await db.query(
    `UPDATE domain_events SET retry_at = now() - interval '1 second', processing_at = now(),
       claim_token = $2, lease_expires_at = now() + interval '1 minute' WHERE id = $1`,
    [eventId, randomUUID()],
  );
  await processOne();
  assert.deepEqual(await effects(), [first]);
  await db.query("UPDATE domain_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [eventId]);
  await Promise.all([processOne(), processOne()]);
  assert.deepEqual(await effects(), [first, second]);
  const { rows: [finished] } = await db.query(
    "SELECT processed_at, failed_at, claim_token FROM domain_events WHERE id = $1", [eventId],
  );
  assert.ok(finished.processed_at);
  assert.equal(finished.failed_at, null);
  assert.equal(finished.claim_token, null);
});

test("R14 permanent action failure remains recorded without repeating earlier effects", { timeout: 15_000 }, async () => {
  const first = "R14 effect before terminal failure";
  const second = "R14 invalid destination section";
  const { a, eventId, ruleId } = await seedRule("Terminal automation failure", [
    createTask(first), createTask(second, { section_id: 999_999_999 }),
  ]);
  await processOne();
  const { rows: [failed] } = await db.query("SELECT failed_at, last_error FROM domain_events WHERE id = $1", [eventId]);
  assert.ok(failed.failed_at);
  assert.ok(failed.last_error);
  const { rows: [run] } = await db.query("SELECT status FROM rule_runs WHERE rule_id = $1 AND event_id = $2", [ruleId, eventId]);
  assert.equal(run?.status, "failed");
  await processOne();
  const { rows } = await db.query("SELECT name FROM tasks WHERE project_id = $1 AND name = ANY($2::text[])", [a, [first, second]]);
  assert.deepEqual(rows.map(({ name }) => name), [first]);
});
