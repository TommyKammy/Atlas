import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(async () => {
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

async function fixture(actions, extra = {}) {
  const f = await fixtures(`AR10 ${randomUUID()}`);
  const subject = await task(f.a, "AR10 subject");
  const { id } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, {
    name: "AR10 manual result", definition: {
      triggers: [{ event: "task.manual_rule" }], actions, ...extra,
    },
  });
  return { ...f, subject, rule: id, path: `/api/projects/${f.a}/rules/${id}` };
}

const create = (name) => [{ capability: "task.create", params: { name } }];

test("AR10 manual run processes its own event behind a backlog and leaves unrelated events untouched", async () => {
  const name = `AR10 executed ${randomUUID()}`;
  const f = await fixture(create(name));
  const backlog = await db.query(
    `INSERT INTO domain_events (workspace_id,project_id,type,subject_type,subject_id)
     SELECT 1,$1,'task.created','task',$2 FROM generate_series(1,25) RETURNING id`, [f.a, f.subject],
  );
  const result = await request(f.owner, "POST", `${f.path}/run`, 201, { task_id: f.subject });
  assert.equal(result.status, "success");
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id=$1 AND name=$2", [f.a, name])).rowCount, 1);
  assert.equal((await db.query(
    "SELECT id FROM domain_events WHERE id=ANY($1::bigint[]) AND processed_at IS NULL AND attempts=0",
    [backlog.rows.map((row) => row.id)],
  )).rowCount, 25);
  const receipt = await request(f.owner, "GET", `${f.path}/runs?event_id=${result.event_id}`, 200);
  assert.deepEqual(receipt.execution, result);
  assert.equal(receipt.runs.length, 1);
  assert.equal(receipt.runs[0].event_id, result.event_id);
});

test("AR10 disabled and nonmanual rules reject before creating events", async () => {
  const f = await fixture(create("must not run"));
  await request(f.owner, "PATCH", f.path, 200, { enabled: false });
  await request(f.owner, "POST", `${f.path}/run`, 409, { task_id: f.subject });
  await request(f.owner, "PATCH", f.path, 200, {
    enabled: true, definition: { triggers: [{ event: "task.created" }], actions: create("must not run") },
  });
  await request(f.owner, "POST", `${f.path}/run`, 409, { task_id: f.subject });
  assert.equal((await db.query(
    "SELECT id FROM domain_events WHERE project_id=$1 AND type='task.manual_rule'", [f.a],
  )).rowCount, 0);
});

test("AR10 unmatched conditions return skipped and deterministic action errors return failed", async () => {
  const f = await fixture(create("not matched"), { conditions: [{ field: "task.name", op: "eq", value: "another task" }] });
  const skipped = await request(f.owner, "POST", `${f.path}/run`, 201, { task_id: f.subject });
  assert.equal(skipped.status, "skipped");
  await request(f.owner, "PATCH", f.path, 200, {
    definition: { triggers: [{ event: "task.manual_rule" }], actions: create("{{task.description}}") },
  });
  const failed = await request(f.owner, "POST", `${f.path}/run`, 201, { task_id: f.subject });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /required/);
});

test("AR10 deferred result can be polled for the same event after retry without another submission", async (t) => {
  const name = `AR10 retry ${randomUUID()}`;
  const f = await fixture(create(name));
  const suffix = randomUUID().replaceAll("-", "");
  const fn = `ar10_retry_${suffix}`;
  await db.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.project_id=${f.a} AND NEW.name='${name}' THEN
      RAISE EXCEPTION 'temporary serialization failure' USING ERRCODE='40001';
    END IF; RETURN NEW; END $$`);
  await db.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  const drop = () => db.query(`DROP TRIGGER IF EXISTS ${fn} ON tasks; DROP FUNCTION IF EXISTS ${fn}()`);
  t.after(drop);
  const queued = await request(f.owner, "POST", `${f.path}/run`, 202, { task_id: f.subject });
  assert.equal(queued.status, "queued");
  const pending = await request(f.owner, "GET", `${f.path}/runs?event_id=${queued.event_id}`, 200);
  assert.equal(pending.execution.status, "queued");
  assert.deepEqual(pending.runs, []);
  await drop();
  await db.query("UPDATE domain_events SET retry_at=clock_timestamp() WHERE id=$1", [queued.event_id]);
  const processed = await http("/api/automation/process?limit=20", {
    method: "POST", headers: { "x-automation-token": "atlas-regression-worker" }, timeout: 10_000,
  });
  assert.equal(processed.status, 200, await processed.text());
  const completed = await request(f.owner, "GET", `${f.path}/runs?event_id=${queued.event_id}`, 200);
  assert.equal(completed.execution.status, "success");
  assert.equal(completed.runs.length, 1);
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id=$1 AND name=$2", [f.a, name])).rowCount, 1);
  const other = await fixture(create("other receipt"));
  await request(other.owner, "GET", `${other.path}/runs?event_id=${queued.event_id}`, 404);
  await request(f.owner, "GET", `${f.path}/runs?event_id=0`, 400);
});
