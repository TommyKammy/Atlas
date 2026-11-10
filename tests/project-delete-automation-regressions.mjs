import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, projectOf, request, task, waitForHttp } from "./regression-fixtures.mjs";

// regression-fixtures checks the exact disposable DATABASE_URL before this
// process imports production services. Only Next's request-rendering marker is
// replaced; pg, transactions, lease fencing and SQL locks are the real code.
const nextServer = createRequire(import.meta.url)("next/server");
const connectionMarker = mock.method(nextServer, "connection", async () => {});
const {
  AutomationClaimLost, failInterruptedAutomationEvent, finishAutomationEvent,
  retryAutomationEvent, withAutomationClaim,
} = await import("../lib/automation/lease.ts");
after(() => connectionMarker.mock.restore());

const repeats = Number(process.env.ATLAS_PROJECT_DELETE_REPEAT ?? 1);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 500,
  "ATLAS_PROJECT_DELETE_REPEAT must be an integer from 1 to 500");
const options = { timeout: Math.max(30_000, repeats * 15_000) };
const workerHeaders = { "x-automation-token": "atlas-regression-worker" };
const GATE_NAMESPACE = 1279542859;

before(waitForHttp);
beforeEach(async () => {
  await db.query("UPDATE project_rules SET enabled = FALSE WHERE enabled");
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function observed(promise) {
  // The result is still asserted later; register a handler immediately while
  // another concurrent participant is deliberately held at a database lock.
  void promise.catch(() => undefined);
  return promise;
}

async function deadline(promise, label, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(label, predicate, milliseconds = 3000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await delay(10);
  }
  assert.fail(label);
}

async function backendWaitingOn(blockerPid) {
  return (await db.query(
    `SELECT pid, query FROM pg_stat_activity
     WHERE datname = current_database() AND $1::integer = ANY(pg_blocking_pids(pid))
     ORDER BY pid`, [blockerPid],
  )).rows[0];
}

async function claimFixture(label, { nullProject = false } = {}) {
  const f = await fixtures(`Project deletion ${label} ${randomUUID()}`);
  const subject = await task(f.a, `Subject ${label}`);
  const claimToken = randomUUID();
  const { rows: [event] } = await db.query(
    `INSERT INTO domain_events
       (workspace_id, project_id, actor_id, type, subject_type, subject_id,
        claim_token, lease_expires_at, attempts)
     VALUES (1, $1, $2, 'task.created', 'task', $3, $4::uuid, now() + interval '5 minutes', 1)
     RETURNING id`,
    [nullProject ? null : f.a, f.ownerId, subject, claimToken],
  );
  return { ...f, subject, claim: { id: Number(event.id), claimToken } };
}

function deletion(f, trash = false) {
  return observed(http(`/api/projects/${f.a}${trash ? "/trash" : ""}`, {
    cookie: f.owner, method: "DELETE", timeout: 12_000,
  }).then(async (response) => ({ status: response.status, body: await response.text() })));
}

async function eventState(q, id) {
  return (await q.query(
    `SELECT processed_at IS NOT NULL AS processed, failed_at IS NOT NULL AS failed,
       retry_at IS NOT NULL AS retrying, claim_token IS NULL AS released
     FROM domain_events WHERE id = $1`, [id],
  )).rows[0];
}

async function workerFirst(f, finish, { trash = false, eventSurvives = false } = {}) {
  if (trash) await db.query("UPDATE projects SET deleted_at = now() WHERE id = $1", [f.a]);
  const release = deferred();
  let workerPid;
  let deleting;
  const working = observed(withAutomationClaim(f.claim, async (q) => {
    workerPid = (await q.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await deadline(release.promise, "worker-first operation was not released");
    await finish(q, f.claim.id);
    return eventState(q, f.claim.id);
  }));
  try {
    await until("worker did not enter its fenced transaction", () => workerPid);
    deleting = deletion(f, trash);
    await until("project deletion did not wait for the active worker", () => backendWaitingOn(workerPid));
    release.resolve();
    const results = await Promise.allSettled([working, deleting]);
    assert.equal(results[0].status, "fulfilled", `worker must not deadlock: ${results[0].reason?.stack}`);
    assert.equal(results[1].status, "fulfilled", `DELETE must complete: ${results[1].reason?.stack}`);
    assert.equal(results[1].value.status, 200, results[1].value.body);
    assert.equal((await db.query("SELECT id FROM projects WHERE id = $1", [f.a])).rowCount, 0);
    assert.equal((await db.query("SELECT id FROM domain_events WHERE id = $1", [f.claim.id])).rowCount,
      eventSurvives ? 1 : 0);
    return results[0].value;
  } finally {
    release.resolve();
    await Promise.allSettled([working, ...(deleting ? [deleting] : [])]);
  }
}

test("project deletion waits for a no-rule worker before cascading its event", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await claimFixture(`finish ${index}`);
    const state = await workerFirst(f, (q, id) => finishAutomationEvent(q, id, null));
    assert.deepEqual(state, { processed: true, failed: false, retrying: false, released: true });
  }
  t.diagnostic(`${repeats} controlled worker-first completion/delete interleavings; no retry`);
});

test("trash permanent deletion waits for the same worker fence", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await claimFixture(`trash ${index}`);
    const state = await workerFirst(f, (q, id) => finishAutomationEvent(q, id, null), { trash: true });
    assert.equal(state.processed, true);
  }
  t.diagnostic(`${repeats} trash permanent-delete/worker interleavings`);
});

test("retry and terminal-failure worker writes use the deletion lock order", options, async (t) => {
  const finishes = [
    ["retry", (q, id) => retryAutomationEvent(q, id, 1, "retry fixture"),
      { processed: false, failed: false, retrying: true, released: true }],
    ["failure", (q, id) => finishAutomationEvent(q, id, "terminal fixture"),
      { processed: false, failed: true, retrying: false, released: true }],
    ["interrupted", (q, id) => failInterruptedAutomationEvent(q, id, "interrupted fixture"),
      { processed: false, failed: true, retrying: false, released: true }],
  ];
  for (let index = 0; index < repeats; index++) {
    for (const [label, finish, expected] of finishes) {
      const f = await claimFixture(`${label} ${index}`);
      assert.deepEqual(await workerFirst(f, finish), expected);
    }
  }
  t.diagnostic(`${repeats * finishes.length} retry/failure/delete interleavings`);
});

test("deletion-first fences a claimed worker before it can lock the event", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await claimFixture(`delete first ${index}`);
    const name = `project_delete_gate_${randomUUID().replaceAll("-", "")}`;
    const gate = await db.connect();
    let deleting;
    let working;
    let operationEntered = false;
    try {
      const gatePid = (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await gate.query("SELECT pg_advisory_lock($1, $2)", [GATE_NAMESPACE, f.a]);
      await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(${GATE_NAMESPACE}, ${f.a}); RETURN OLD; END $$;
        CREATE TRIGGER ${name} BEFORE DELETE ON projects FOR EACH ROW
        WHEN (OLD.id = ${f.a}) EXECUTE FUNCTION ${name}()`);
      deleting = deletion(f);
      const deleter = await until("DELETE did not reach its controlled SQL gate", () => backendWaitingOn(gatePid));
      working = observed(withAutomationClaim(f.claim, async (q) => {
        operationEntered = true;
        await finishAutomationEvent(q, f.claim.id, null);
      }));
      await until("worker did not wait behind deletion", () => backendWaitingOn(deleter.pid));
      assert.equal(operationEntered, false, "delete-first must stop work before the callback");
      const probe = await db.connect();
      try {
        await probe.query("BEGIN");
        const available = await probe.query("SELECT id FROM domain_events WHERE id = $1 FOR UPDATE NOWAIT", [f.claim.id]);
        assert.equal(available.rowCount, 1, "a blocked worker must not hold the event row");
      } finally {
        await probe.query("ROLLBACK");
        probe.release();
      }
      await gate.query("SELECT pg_advisory_unlock($1, $2)", [GATE_NAMESPACE, f.a]);
      const removed = await deleting;
      assert.equal(removed.status, 200, removed.body);
      await assert.rejects(working, AutomationClaimLost);
      assert.equal(operationEntered, false);
      assert.equal((await db.query("SELECT id FROM domain_events WHERE id = $1", [f.claim.id])).rowCount, 0);
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await Promise.allSettled([...(working ? [working] : []), ...(deleting ? [deleting] : [])]);
      await db.query(`DROP TRIGGER IF EXISTS ${name} ON projects; DROP FUNCTION IF EXISTS ${name}()`);
    }
  }
  t.diagnostic(`${repeats} controlled delete-first/claim-lost interleavings`);
});

test("a NULL-project event remains processable while another project is deleted", options, async () => {
  for (let index = 0; index < repeats; index++) {
    const f = await claimFixture(`null project ${index}`, { nullProject: true });
    const state = await workerFirst(f, (q, id) => finishAutomationEvent(q, id, null), { eventSurvives: true });
    assert.equal(state.processed, true);
  }
});

test("shared automation access allows independent project workers to run together", options, async () => {
  for (let index = 0; index < repeats; index++) {
    const first = await claimFixture(`parallel first ${index}`);
    const second = await claimFixture(`parallel second ${index}`);
    const release = deferred();
    let firstEntered = false;
    const working = observed(withAutomationClaim(first.claim, async (q) => {
      firstEntered = true;
      await deadline(release.promise, "independent worker did not release first worker");
      await finishAutomationEvent(q, first.claim.id, null);
    }));
    try {
      await until("first worker did not acquire shared access", () => firstEntered);
      await deadline(withAutomationClaim(second.claim, (q) => finishAutomationEvent(q, second.claim.id, null)),
        "shared access incorrectly serialized independent project workers", 3000);
      assert.equal((await db.query("SELECT processed_at IS NOT NULL AS done FROM domain_events WHERE id=$1", [second.claim.id])).rows[0].done, true);
    } finally {
      release.resolve();
      await working;
    }
  }
});

test("real workers execute once while deletion preserves a multi-homed task and its side effect", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await fixtures(`Delete real worker ${index} ${randomUUID()}`);
    const parent = await task(f.a, "Shared parent");
    const child = await task(f.a, "Shared child", parent);
    await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES ($1,$2)", [parent, f.b]);
    const marker = `Once before deletion ${randomUUID()}`;
    const { id: ruleId } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, {
      name: "Concurrent deletion rule", definition: { triggers: [{ event: "task.manual_rule" }],
        actions: [{ capability: "task.add_comment", params: { body: marker } }] },
    });
    const { rows: [event] } = await db.query(
      `INSERT INTO domain_events(workspace_id,project_id,actor_id,type,subject_type,subject_id,data)
       VALUES(1,$1,$2,'task.manual_rule','task',$3,$4::jsonb) RETURNING id`,
      [f.a, f.ownerId, parent, JSON.stringify({ manual: true, target_rule_id: ruleId })],
    );
    const name = `project_run_gate_${randomUUID().replaceAll("-", "")}`;
    const gate = await db.connect();
    let working;
    let deleting;
    try {
      const gatePid = (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await gate.query("SELECT pg_advisory_lock($1,$2)", [GATE_NAMESPACE, f.a]);
      await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(${GATE_NAMESPACE}, ${f.a}); RETURN NEW; END $$;
        CREATE TRIGGER ${name} BEFORE INSERT ON rule_runs FOR EACH ROW
        WHEN (NEW.rule_id = ${Number(ruleId)}) EXECUTE FUNCTION ${name}()`);
      working = observed(http("/api/automation/process?limit=1", {
        method: "POST", headers: workerHeaders, timeout: 12_000,
      }).then(async (response) => ({ status: response.status, body: await response.text() })));
      const worker = await until("real rule action did not reach its transactional checkpoint", () => backendWaitingOn(gatePid));
      const competitor = await http("/api/automation/process?limit=1", {
        method: "POST", headers: workerHeaders, timeout: 5000,
      });
      assert.equal(competitor.status, 200, await competitor.text());
      assert.equal((await db.query("SELECT attempts FROM domain_events WHERE id=$1", [event.id])).rows[0].attempts, 1,
        "a second worker must not claim the fenced event");
      deleting = deletion(f);
      await until("DELETE did not wait for the real in-flight action", () => backendWaitingOn(worker.pid));
      await gate.query("SELECT pg_advisory_unlock($1,$2)", [GATE_NAMESPACE, f.a]);
      const results = await Promise.all([working, deleting]);
      assert.equal(results[0].status, 200, results[0].body);
      assert.equal(results[1].status, 200, results[1].body);
      assert.equal(await projectOf(parent), f.b);
      assert.equal(await projectOf(child), f.b);
      assert.equal((await db.query("SELECT task_id FROM task_project_memberships WHERE task_id=$1 AND project_id=$2", [parent, f.a])).rowCount, 0);
      assert.equal((await db.query("SELECT id FROM comments WHERE task_id=$1 AND body=$2", [parent, marker])).rowCount, 1);
      assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id=$1", [f.a])).rowCount, 0);
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await Promise.allSettled([...(working ? [working] : []), ...(deleting ? [deleting] : [])]);
      await db.query(`DROP TRIGGER IF EXISTS ${name} ON rule_runs; DROP FUNCTION IF EXISTS ${name}()`);
    }
  }
  t.diagnostic(`${repeats} real two-worker/action/delete interleavings with shared parent+child preservation`);
});

test("two authorized deletions stay idempotent after waiting for the deletion gate", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    for (const trash of [false, true]) {
      const f = await claimFixture(`double delete ${trash} ${index}`);
      const shared = await task(f.a, "Shared double-delete parent");
      const child = await task(f.a, "Shared double-delete child", shared);
      const untouched = await task(f.b, "Unrelated task must remain identical");
      const before = (await db.query("SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1", [untouched])).rows[0].data;
      await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [shared, f.b]);
      if (trash) await db.query("UPDATE projects SET deleted_at=now() WHERE id=$1", [f.a]);
      const gate = await db.connect();
      let first;
      let second;
      try {
        await gate.query("SELECT pg_advisory_lock(1096043603, 2)");
        first = deletion(f, trash);
        second = deletion(f, trash);
        await until("both authorized DELETE requests must wait at the deletion gate", async () => {
          const { rows } = await db.query(
            `SELECT l.pid FROM pg_locks l
             WHERE l.locktype='advisory' AND l.classid=1096043603 AND l.objid=2
               AND l.objsubid=2 AND NOT l.granted
               AND cardinality(pg_blocking_pids(l.pid)) > 0`,
          );
          return rows.length === 2;
        });
        await gate.query("SELECT pg_advisory_unlock(1096043603, 2)");
        const results = await Promise.all([first, second]);
        for (const result of results) assert.equal(result.status, 200, result.body);
        assert.deepEqual(results.map((result) => JSON.parse(result.body).moved_tasks).sort(), [0, 1]);
        const { rows: auditRows } = await db.query(
          "SELECT project_id FROM audit_log WHERE action='project.delete' AND entity_id=$1", [f.a],
        );
        assert.equal(auditRows.length, 1, "the no-op second DELETE must not append a second audit entry");
        assert.equal(auditRows[0].project_id, null);
        assert.equal(await projectOf(shared), f.b);
        assert.equal(await projectOf(child), f.b);
        assert.deepEqual((await db.query("SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1", [untouched])).rows[0].data, before);
      } finally {
        await gate.query("SELECT pg_advisory_unlock_all()");
        gate.release();
        await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])]);
      }
    }
  }
  t.diagnostic(`${repeats * 2} normal/trash double-delete gate interleavings`);
});

test("failed deletion rolls back task promotion, memberships and its audit entry", options, async () => {
  for (let index = 0; index < repeats; index++) {
    const f = await fixtures(`Delete rollback ${index} ${randomUUID()}`);
    const shared = await task(f.a, "Rollback parent");
    const child = await task(f.a, "Rollback child", shared);
    await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [shared, f.b]);
    const load = async () => ({
      tasks: (await db.query("SELECT to_jsonb(t) AS data FROM tasks t WHERE id=ANY($1::bigint[]) ORDER BY id", [[shared, child]])).rows,
      homes: (await db.query("SELECT * FROM task_project_memberships WHERE task_id=$1 ORDER BY project_id", [shared])).rows,
      audits: (await db.query("SELECT * FROM audit_log WHERE action='project.delete' AND entity_id=$1 ORDER BY id", [f.a])).rows,
    });
    const before = await load();
    const name = `project_delete_fail_${randomUUID().replaceAll("-", "")}`;
    try {
      await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'forced project deletion rollback fixture' USING ERRCODE='P0001'; END $$;
        CREATE TRIGGER ${name} BEFORE DELETE ON projects FOR EACH ROW
        WHEN (OLD.id = ${f.a}) EXECUTE FUNCTION ${name}()`);
      const removed = await deletion(f);
      assert.equal(removed.status, 500, "the explicit fixture error must abort deletion");
      assert.equal((await db.query("SELECT id FROM projects WHERE id=$1", [f.a])).rowCount, 1);
      assert.deepEqual(await load(), before);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${name} ON projects; DROP FUNCTION IF EXISTS ${name}()`);
    }
  }
});

test("a long deletion gate times out a worker without renewing or consuming its claim", { timeout: 15_000 }, async () => {
  // This checks the production five-second lock timeout once, even in the
  // repeated suite. The other tests cover short, successfully serialized waits.
  const f = await claimFixture("deletion gate timeout");
  const snapshot = async () => (await db.query(
    `SELECT claim_token, lease_expires_at::text, processing_at::text,
       processed_at::text, failed_at::text, retry_at::text, attempts, processing_failures
     FROM domain_events WHERE id=$1`, [f.claim.id],
  )).rows[0];
  const before = await snapshot();
  const gate = await db.connect();
  let working;
  let callbackEntered = false;
  try {
    await gate.query("BEGIN");
    const gatePid = (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await gate.query("SELECT pg_advisory_xact_lock(1096043603, 2)");
    working = observed(withAutomationClaim(f.claim, async (q) => {
      callbackEntered = true;
      await finishAutomationEvent(q, f.claim.id, null);
    }));
    const worker = await until("worker did not wait for the long deletion gate", () => backendWaitingOn(gatePid));
    await assert.rejects(deadline(working, "the production lock timeout did not fire", 7500),
      (error) => error?.code === "55P03", "the worker must report the production lock timeout");
    assert.equal(callbackEntered, false, "timed-out work must not enter the operation");
    assert.deepEqual(await snapshot(), before, "waiting for project access must not renew or mutate the event");
    const { rows: [backend] } = await db.query(
      "SELECT state, xact_start FROM pg_stat_activity WHERE pid=$1", [worker.pid],
    );
    assert.equal(backend?.state, "idle");
    assert.equal(backend.xact_start, null, "the timed-out transaction must be rolled back");
    assert.equal((await db.query(
      "SELECT pid FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [worker.pid],
    )).rowCount, 0, "the timed-out worker must not retain an advisory lock");
    await gate.query("ROLLBACK");
    const resumed = await deadline(withAutomationClaim(f.claim, async (q) => {
      await finishAutomationEvent(q, f.claim.id, null);
      return eventState(q, f.claim.id);
    }), "the same claim could not resume after deletion access was released", 3000);
    assert.deepEqual(resumed, { processed: true, failed: false, retrying: false, released: true });
  } finally {
    await gate.query("ROLLBACK").catch(() => undefined);
    gate.release();
    if (working) await Promise.allSettled([working]);
  }
});
