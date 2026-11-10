import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, projectOf, task, waitForHttp } from "./regression-fixtures.mjs";

// The fixture module rejects every database except the disposable atlas_p0 DB.
// Keep the production SQL/transactions intact; only Next's request marker is a
// no-op when these services are called outside an HTTP request.
const nextServer = createRequire(import.meta.url)("next/server");
const connectionMarker = mock.method(nextServer, "connection", async () => {});
const { processAutomationEvent } = await import("../lib/automation/engine.ts");
const { finishAutomationEvent, withAutomationClaim } = await import("../lib/automation/lease.ts");
const { processScheduledTriggers } = await import("../lib/automation/scheduled.ts");
after(() => connectionMarker.mock.restore());

const repeats = Number(process.env.ATLAS_PROJECT_DELETE_REPEAT ?? 1);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 500,
  "ATLAS_PROJECT_DELETE_REPEAT must be an integer from 1 to 500");
const options = { timeout: Math.max(30_000, repeats * 15_000) };
const LATCH_NAMESPACE = 1128530001;
const scheduledNow = new Date("2047-01-01T03:00:00.000Z");

before(waitForHttp);
beforeEach(async () => {
  // These tests run serially in a fresh, worker-disabled disposable database.
  // Prevent rules/events from earlier regression files entering this scan.
  await db.query("UPDATE project_rules SET enabled = FALSE WHERE enabled");
  await db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function observed(promise) {
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

async function backendWaitingOn(blockerPid, queryPart = "") {
  return (await db.query(
    `SELECT pid, query FROM pg_stat_activity
     WHERE datname = current_database() AND $1::integer = ANY(pg_blocking_pids(pid))
       AND position($2::text in query) > 0
     ORDER BY pid`, [blockerPid, queryPart],
  )).rows[0];
}

function deletion(f) {
  return observed(http(`/api/projects/${f.a}`, {
    cookie: f.owner, method: "DELETE", timeout: 12_000,
  }).then(async (response) => ({ status: response.status, body: await response.text() })));
}

async function scheduledFixture(label) {
  const f = await fixtures(`${label} ${randomUUID()}`);
  const subject = await task(f.a, "Scheduled task");
  await db.query("UPDATE tasks SET due_on = '2047-01-01'::date WHERE id = $1", [subject]);
  const definition = {
    triggers: [{ event: "task.due_soon", days: 0 }],
    actions: [{ capability: "task.set_status", params: { status: "Done" } }],
  };
  const { rows: [rule] } = await db.query(
    `INSERT INTO project_rules(workspace_id, project_id, owner_id, name, definition)
     VALUES (1, $1, $2, $3, $4::jsonb) RETURNING id`,
    [f.a, f.ownerId, label, JSON.stringify(definition)],
  );
  return { ...f, subject, ruleId: Number(rule.id) };
}

async function latch(gate, f, table, timing, condition) {
  const name = `project_extra_gate_${randomUUID().replaceAll("-", "")}`;
  const gatePid = (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await gate.query("SELECT pg_advisory_lock($1, $2)", [LATCH_NAMESPACE, f.a]);
  await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(${LATCH_NAMESPACE}, ${f.a});
      RETURN ${timing === "DELETE" ? "OLD" : "NEW"}; END $$;
    CREATE TRIGGER ${name} BEFORE ${timing} ON ${table} FOR EACH ROW
    WHEN (${condition}) EXECUTE FUNCTION ${name}()`);
  return {
    gatePid,
    unlock: () => gate.query("SELECT pg_advisory_unlock($1, $2)", [LATCH_NAMESPACE, f.a]),
    cleanup: () => db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}; DROP FUNCTION IF EXISTS ${name}()`),
  };
}

async function assertRemoved(f) {
  assert.equal((await db.query("SELECT id FROM projects WHERE id = $1", [f.a])).rowCount, 0);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1", [f.a])).rowCount, 0);
  if (f.ruleId) {
    assert.equal((await db.query("SELECT id FROM project_rules WHERE id = $1", [f.ruleId])).rowCount, 0);
    assert.equal((await db.query("SELECT rule_id FROM automation_fires WHERE rule_id = $1", [f.ruleId])).rowCount, 0);
    assert.equal((await db.query("SELECT rule_id FROM automation_due_soon_scans WHERE rule_id = $1", [f.ruleId])).rowCount, 0);
  }
}

test("scheduled outbox writes finish before real project deletion cascades their rule", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await scheduledFixture(`Scheduled writer first ${index}`);
    const gate = await db.connect();
    let checkpoint;
    let working;
    let deleting;
    try {
      checkpoint = await latch(gate, f, "domain_events", "INSERT", `NEW.project_id = ${f.a} AND NEW.type = 'task.due_soon'`);
      working = observed(processScheduledTriggers(db, scheduledNow));
      // pg_stat_activity.query is truncated to track_activity_query_size
      // (normally 1 KiB). Match the outbox CTE prefix, not its final INSERT.
      const scanner = await until("scheduler did not reach its outbox insert", () =>
        backendWaitingOn(checkpoint.gatePid, "active_rule AS"));
      deleting = deletion(f);
      await until("DELETE did not wait for the scheduled outbox transaction", () => backendWaitingOn(scanner.pid));
      await checkpoint.unlock();
      const [emitted, removed] = await Promise.all([working, deleting]);
      assert.equal(emitted, 1, "the scheduled fire and its outbox event must commit together");
      assert.equal(removed.status, 200, removed.body);
      await assertRemoved(f);
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await Promise.allSettled([...(working ? [working] : []), ...(deleting ? [deleting] : [])]);
      await checkpoint?.cleanup();
    }
  }
  t.diagnostic(`${repeats} controlled scheduler outbox/delete interleavings; no retry`);
});

test("real event claim waits before locking its row when deletion starts first", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await fixtures(`Real claim deletion first ${index} ${randomUUID()}`);
    const subject = await task(f.a, "Surviving shared task");
    await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES ($1,$2)", [subject, f.b]);
    await db.query(
      `INSERT INTO project_rules(workspace_id,project_id,owner_id,name,definition)
       VALUES(1,$1,$2,'Must not run after deletion',$3::jsonb)`,
      [f.a, f.ownerId, JSON.stringify({ triggers: [{ event: "task.created" }],
        actions: [{ capability: "task.set_status", params: { status: "Done" } }] })],
    );
    const { rows: [event] } = await db.query(
      `INSERT INTO domain_events(workspace_id,project_id,actor_id,type,subject_type,subject_id)
       VALUES(1,$1,$2,'task.created','task',$3) RETURNING id`, [f.a, f.ownerId, subject],
    );
    const gate = await db.connect();
    let checkpoint;
    let working;
    let deleting;
    try {
      checkpoint = await latch(gate, f, "projects", "DELETE", `OLD.id = ${f.a}`);
      deleting = deletion(f);
      const deleter = await until("DELETE did not reach the project-row checkpoint", () => backendWaitingOn(checkpoint.gatePid));
      working = observed(processAutomationEvent(Number(event.id)));
      await until("real claim SQL did not wait behind project deletion", () =>
        backendWaitingOn(deleter.pid, "project_automation_guard"));
      const probe = await db.connect();
      try {
        await probe.query("BEGIN");
        const row = await probe.query("SELECT id FROM domain_events WHERE id = $1 FOR UPDATE NOWAIT", [event.id]);
        assert.equal(row.rowCount, 1, "a claim waiting for deletion must not own the event row");
      } finally {
        await probe.query("ROLLBACK");
        probe.release();
      }
      await checkpoint.unlock();
      const [, removed] = await Promise.all([working, deleting]);
      assert.equal(removed.status, 200, removed.body);
      await assertRemoved(f);
      assert.equal(await projectOf(subject), f.b);
      assert.equal((await db.query("SELECT status FROM tasks WHERE id = $1", [subject])).rows[0].status, "inbox");
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await Promise.allSettled([...(working ? [working] : []), ...(deleting ? [deleting] : [])]);
      await checkpoint?.cleanup();
    }
  }
  t.diagnostic(`${repeats} production claim-SQL/delete-first interleavings; no post-delete action`);
});

test("due-soon cursor rechecks a rule deleted while its shared gate was waiting", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await scheduledFixture(`Cursor deletion first ${index}`);
    const gate = await db.connect();
    let checkpoint;
    let working;
    let deleting;
    try {
      checkpoint = await latch(gate, f, "projects", "DELETE", `OLD.id = ${f.a}`);
      deleting = deletion(f);
      const deleter = await until("DELETE did not reach its project checkpoint", () => backendWaitingOn(checkpoint.gatePid));
      working = observed(processScheduledTriggers(db, scheduledNow));
      await until("due-soon cursor SQL did not wait behind project deletion", () =>
        backendWaitingOn(deleter.pid, "INSERT INTO automation_due_soon_scans"));
      await checkpoint.unlock();
      const [emitted, removed] = await Promise.all([working, deleting]);
      assert.equal(removed.status, 200, removed.body);
      assert.equal(emitted, 0, "a stale pre-gate statement snapshot must not insert a cursor or event for the deleted rule");
      await assertRemoved(f);
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await Promise.allSettled([...(working ? [working] : []), ...(deleting ? [deleting] : [])]);
      await checkpoint?.cleanup();
    }
  }
  t.diagnostic(`${repeats} delete-first scheduled-cursor snapshot interleavings; no FK error`);
});

test("cross-project causal parent deletion waits for child finish and then clears its parent", options, async (t) => {
  for (let index = 0; index < repeats; index++) {
    const f = await fixtures(`Causal parent deletion ${index} ${randomUUID()}`);
    const subject = await task(f.b, "Child event subject survives in B");
    const { rows: [parent] } = await db.query(
      `INSERT INTO domain_events(workspace_id,project_id,actor_id,type,subject_type,subject_id,processed_at)
       VALUES(1,$1,$2,'task.created','task',$3,now()) RETURNING id`, [f.a, f.ownerId, subject],
    );
    const claimToken = randomUUID();
    const { rows: [child] } = await db.query(
      `INSERT INTO domain_events(workspace_id,project_id,actor_id,type,subject_type,subject_id,
         causation_id,claim_token,lease_expires_at,attempts)
       VALUES(1,$1,$2,'task.created','task',$3,$4,$5::uuid,now()+interval '5 minutes',1) RETURNING id`,
      [f.b, f.ownerId, subject, parent.id, claimToken],
    );
    const release = deferred();
    let workerPid;
    let deleting;
    const working = observed(withAutomationClaim({ id: Number(child.id), claimToken }, async (q) => {
      workerPid = (await q.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await deadline(release.promise, "causal child operation was not released");
      // Execution fences its causal root after fencing the child event. The
      // global gate must prevent DELETE(root) -> SET NULL(child) reversing it.
      const root = await q.query("SELECT id FROM domain_events WHERE id = $1 FOR UPDATE", [parent.id]);
      assert.equal(root.rowCount, 1);
      await finishAutomationEvent(q, Number(child.id), null);
    }));
    try {
      await until("child worker did not acquire its event fence", () => workerPid);
      deleting = deletion(f);
      await until("parent project deletion did not wait for its cross-project child worker", () => backendWaitingOn(workerPid));
      release.resolve();
      const [, removed] = await Promise.all([working, deleting]);
      assert.equal(removed.status, 200, removed.body);
      await assertRemoved(f);
      const state = (await db.query(
        `SELECT project_id, causation_id, processed_at IS NOT NULL AS processed,
           claim_token IS NULL AS released FROM domain_events WHERE id = $1`, [child.id],
      )).rows[0];
      assert.deepEqual(state, { project_id: f.b, causation_id: null, processed: true, released: true });
    } finally {
      release.resolve();
      await Promise.allSettled([working, ...(deleting ? [deleting] : [])]);
    }
  }
  t.diagnostic(`${repeats} cross-project causal root/child SET NULL interleavings; no retry`);
});
