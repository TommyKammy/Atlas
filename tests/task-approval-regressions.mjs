import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
// This import rejects every database except the runner's new atlas_p0 instance.
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

// Direct inbox reads use production SQL against the real disposable database.
// Only Next's request/render marker is unavailable outside a request handler.
const nextServer = createRequire(import.meta.url)("next/server");
const connectionMarker = mock.method(nextServer, "connection", async () => {});
const { getInbox, getUnreadCount } = await import("../lib/data.ts");
const { executeCapability } = await import("../lib/capabilities/index.ts");
after(() => connectionMarker.mock.restore());
before(waitForHttp);

async function fixture(label) {
  const f = await fixtures(`Approval ${label} ${randomUUID()}`);
  const { rows } = await db.query(
    `INSERT INTO users(name,is_admin) VALUES ($1,false),($2,false),($3,false),($4,false),($5,true)
     RETURNING id,name`,
    ["Approval approver", "Approval peer", "Approval viewer", "Approval outsider", "Approval workspace admin"],
  );
  const [approver, peer, viewer, outsider, administrator] = rows;
  await db.query(
    `INSERT INTO project_members(project_id,user_id,role)
     VALUES($1,$2,'editor'),($1,$3,'editor'),($1,$4,'viewer')`,
    [f.a, approver.id, peer.id, viewer.id],
  );
  const id = await task(f.a, label);
  await db.query("UPDATE tasks SET created_by=$2,assignee_id=$2 WHERE id=$1", [id, f.editorId]);
  return {
    ...f, id, path: `/api/tasks/${id}/approval`, requester: f.editor, requesterId: Number(f.editorId),
    approver: await session(approver.id), approverId: Number(approver.id),
    peer: await session(peer.id), peerId: Number(peer.id), viewer: await session(viewer.id), viewerId: Number(viewer.id),
    outsider: await session(outsider.id), outsiderId: Number(outsider.id),
    administrator: await session(administrator.id), administratorId: Number(administrator.id),
  };
}

const details = (f, cookie = f.requester) => request(cookie, "GET", f.path, 200);
const version = (state) => ({
  expected_version: state.approval?.version ?? 0,
  expected_updated_at: state.task_updated_at,
});
async function act(f, action, { cookie = f.requester, state, status = 200, ...fields } = {}) {
  const current = state ?? await details(f, cookie);
  return request(cookie, "POST", f.path, status, { action, ...version(current), ...fields });
}
const submit = (f, fields = {}) => act(f, "request", { approver_id: f.approverId, ...fields });
async function taskState(f) {
  return (await db.query(
    `SELECT completed,completed_at::text,updated_at::text,is_milestone,recurrence FROM tasks WHERE id=$1`, [f.id],
  )).rows[0];
}
async function footprint(f) {
  return (await db.query(
    `SELECT (SELECT to_jsonb(t) FROM tasks t WHERE id=$1) AS task,
      (SELECT to_jsonb(a) FROM task_approvals a WHERE task_id=$1) AS approval,
      (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.version),'[]') FROM task_approval_history h WHERE task_id=$1) AS history,
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM task_events e WHERE task_id=$1) AS events,
      (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.event_id,r.user_id),'[]') FROM task_event_recipients r JOIN task_events e ON e.id=r.event_id WHERE e.task_id=$1) AS recipients,
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM domain_events e WHERE subject_type='task' AND subject_id=$1) AS outbox`,
    [f.id],
  )).rows[0];
}

test("approval request and approval persist one decision, completion, recipient and immutable history", async () => {
  const f = await fixture("request and approve");
  const initial = await details(f);
  assert.equal(initial.approval, null);
  assert.equal(initial.can_request, true);
  assert.ok(initial.task_updated_at);
  assert.ok(initial.eligible_approvers.some((p) => p.id === f.approverId));
  assert.ok(!initial.eligible_approvers.some((p) => p.id === f.requesterId || p.id === f.viewerId));
  const pending = await submit(f);
  assert.equal(pending.approval.status, "pending");
  assert.equal(pending.approval.requester_id, f.requesterId);
  assert.equal(pending.approval.approver_id, f.approverId);
  assert.equal(pending.approval.round, 1);
  assert.equal(pending.approval.version, 1);
  assert.equal(pending.can_manage, true);
  assert.equal(pending.can_decide, false);
  assert.equal((await taskState(f)).completed, false);
  assert.deepEqual(pending.history.map((h) => h.action), ["request"]);
  const requestedBy = pending.history[0].actor_name;
  await db.query("UPDATE users SET name='Renamed requester' WHERE id=$1", [f.requesterId]);
  const approved = await act(f, "approve", { cookie: f.approver, comment: "Reviewed document" });
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.approval.version, 2);
  assert.equal(approved.approval.round, 1);
  assert.ok(approved.approval.decided_at);
  const state = await taskState(f);
  assert.equal(state.completed, true);
  assert.ok(state.completed_at);
  assert.deepEqual(approved.history.map((h) => h.action), ["request", "approve"]);
  assert.equal(approved.history[0].actor_name, requestedBy, "history keeps the actor name at the time of request");
  assert.equal(approved.history[1].comment, "Reviewed document");
  const { rows: notifications } = await db.query(
    `SELECT e.kind,r.user_id FROM task_events e JOIN task_event_recipients r ON r.event_id=e.id
     WHERE e.task_id=$1 ORDER BY e.id,r.user_id`, [f.id],
  );
  assert.ok(notifications.some((n) => n.kind === "approval_request" && Number(n.user_id) === f.approverId));
  assert.ok(notifications.some((n) => n.kind === "approval_approve" && Number(n.user_id) === f.requesterId));
});

test("approval completion runs legacy task_completed automation once without replaying a duplicate decision", async () => {
  const f = await fixture("legacy completion compatibility");
  await submit(f);
  const { id: automationId } = await request(f.requester, "POST", `/api/projects/${f.a}/automations`, 201, {
    name: "Approval legacy status rule", trigger: "task_completed",
    action_type: "set_status", action_value: "reviewed",
  });
  const approved = await act(f, "approve", { cookie: f.approver });
  assert.equal(approved.approval.status, "approved");
  const load = async () => (await db.query(
    `SELECT t.completed,t.status,
      (SELECT count(*)::int FROM automation_runs r WHERE r.automation_id=$2 AND r.task_id=t.id) AS runs
     FROM tasks t WHERE t.id=$1`, [f.id, automationId],
  )).rows[0];
  assert.deepEqual(await load(), { completed: true, status: "reviewed", runs: 1 });
  const stable = await footprint(f);
  // The legacy action updates tasks.updated_at after the approval transaction.
  // Read that current stamp so this rejects a repeated decision, not stale data.
  const current = await details(f, f.approver);
  await act(f, "approve", { cookie: f.approver, state: current, status: 409 });
  assert.deepEqual(await load(), { completed: true, status: "reviewed", runs: 1 });
  assert.deepEqual(await footprint(f), stable);
});

test("changes requested and rejection require reasons and may be resubmitted in fresh rounds", async () => {
  const f = await fixture("changes and resubmission");
  await submit(f);
  const before = await footprint(f);
  for (const action of ["reject", "request_changes"]) {
    for (const comment of [undefined, "", " \t "]) {
      await act(f, action, { cookie: f.approver, comment, status: 400 });
      assert.deepEqual(await footprint(f), before);
    }
  }
  const returned = await act(f, "request_changes", { cookie: f.approver, comment: "Please add the estimate" });
  assert.equal(returned.approval.status, "changes_requested");
  assert.equal((await taskState(f)).completed, false);
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 200, { description: "Estimate added" });
  const next = await act(f, "resubmit", { approver_id: f.approverId, comment: "Updated estimate" });
  assert.equal(next.approval.round, 2);
  assert.equal(next.approval.version, 3);
  assert.equal(next.approval.decided_at, null);
  const rejected = await act(f, "reject", { cookie: f.approver, comment: "Budget not accepted" });
  assert.equal(rejected.approval.status, "rejected");
  assert.equal((await taskState(f)).completed, false);
  const retried = await act(f, "resubmit", { approver_id: f.approverId });
  assert.equal(retried.approval.round, 3);
  const approved = await act(f, "approve", { cookie: f.approver });
  assert.equal(approved.approval.version, 6);
  assert.deepEqual(approved.history.map((h) => h.action), ["request", "request_changes", "resubmit", "reject", "resubmit", "approve"]);
  assert.deepEqual(approved.history.map((h) => h.round), [1, 1, 2, 2, 3, 3]);
});

test("only the designated approver decides; requester, peer and administrators cannot decide on their behalf", async () => {
  const f = await fixture("decision authority");
  await submit(f);
  for (const cookie of [f.requester, f.owner, f.peer, f.administrator]) {
    const state = await details(f, cookie);
    assert.equal(state.can_decide, false);
    await act(f, "approve", { cookie, state, status: 403 });
  }
  await request(f.viewer, "GET", f.path, 200);
  await act(f, "approve", { cookie: f.viewer, status: 403 });
  await request(f.outsider, "GET", f.path, 403);
  const pending = await details(f);
  await request(f.outsider, "POST", f.path, 403, { action: "approve", ...version(pending) });
  assert.equal((await details(f)).history.length, 1);
  await act(f, "approve", { cookie: f.approver });
});

test("only requester or the current primary project administrator can reassign or resubmit", async () => {
  const f = await fixture("management authority");
  await submit(f);
  await act(f, "reassign", { cookie: f.peer, approver_id: f.peerId, status: 403 });
  await act(f, "reassign", { cookie: f.approver, approver_id: f.peerId, status: 403 });
  const reassigned = await act(f, "reassign", { cookie: f.owner, approver_id: f.peerId });
  assert.equal(reassigned.approval.approver_id, f.peerId);
  assert.equal(reassigned.approval.round, 2);
  await act(f, "approve", { cookie: f.approver, status: 403 });
  await act(f, "reject", { cookie: f.peer, comment: "Not ready" });
  await act(f, "resubmit", { cookie: f.approver, approver_id: f.peerId, status: 403 });
  const resubmitted = await act(f, "resubmit", { cookie: f.requester, approver_id: f.approverId });
  assert.equal(resubmitted.approval.round, 3);
  assert.equal(resubmitted.approval.requester_id, f.requesterId);
});

test("an administrator cannot resubmit to themselves when the original requester is another member", async () => {
  const f = await fixture("administrator self-resubmission");
  // A requests B's approval. B is also a project administrator, while C is an editor.
  await db.query("UPDATE project_members SET role='admin' WHERE project_id=$1 AND user_id=$2", [f.a, f.approverId]);
  await submit(f);
  await act(f, "approve", { cookie: f.approver });
  const current = await details(f, f.approver);
  assert.equal(current.can_manage, true);
  assert.equal(current.approval.requester_id, f.requesterId);
  assert.ok(!current.eligible_approvers.some((person) => person.id === f.approverId),
    "the current requesting administrator is excluded even when a different original requester is retained");
  const before = await footprint(f);
  await act(f, "resubmit", { cookie: f.approver, state: current, approver_id: f.approverId, status: 400 });
  assert.deepEqual(await footprint(f), before);

  const resubmitted = await act(f, "resubmit", { cookie: f.approver, approver_id: f.peerId });
  assert.equal(resubmitted.approval.status, "pending");
  assert.equal(resubmitted.approval.round, 2);
  assert.equal(resubmitted.approval.version, 3);
  assert.equal(resubmitted.approval.requester_id, f.requesterId);
  assert.equal(resubmitted.approval.approver_id, f.peerId);
  assert.equal(resubmitted.history.at(-1).actor_id, f.approverId);
  const pending = await footprint(f);
  await act(f, "approve", { cookie: f.approver, status: 403 });
  assert.deepEqual(await footprint(f), pending);
  const approved = await act(f, "approve", { cookie: f.peer });
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.approval.version, 4);
  assert.deepEqual(approved.history.map((entry) => entry.action), ["request", "approve", "resubmit", "approve"]);
  assert.deepEqual(approved.history.map((entry) => entry.actor_id), [f.requesterId, f.approverId, f.approverId, f.peerId]);
});

test("approver selection rejects self, viewer, outsider, inactive and malformed identities", async () => {
  const f = await fixture("selection validation");
  const before = await footprint(f);
  const inactive = (await db.query("INSERT INTO users(name,deactivated_at) VALUES('Inactive approver',now()) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')", [f.a, inactive]);
  for (const approver_id of [f.requesterId, f.viewerId, f.outsiderId, Number(inactive), 0, -1, 1.5, "wrong", null]) {
    await submit(f, { approver_id, status: 400 });
    assert.deepEqual(await footprint(f), before);
  }
  const state = await details(f);
  assert.ok(!state.eligible_approvers.some((p) => [f.requesterId, f.viewerId, f.outsiderId, Number(inactive)].includes(p.id)));
});

test("approval rejects missing optimistic guards, unknown actions and malformed comments without side effects", async () => {
  const f = await fixture("invalid payloads");
  const initial = await details(f);
  const valid = { action: "request", approver_id: f.approverId, ...version(initial) };
  const invalid = [
    {}, { ...valid, action: "wait" }, { ...valid, action: "resume" },
    { ...valid, expected_version: undefined }, { ...valid, expected_version: -1 },
    { ...valid, expected_version: 0.5 }, { ...valid, expected_updated_at: undefined },
    { ...valid, expected_updated_at: "bad date" }, { ...valid, comment: { unsafe: true } },
  ];
  const before = await footprint(f);
  for (const body of invalid) {
    await request(f.requester, "POST", f.path, 400, body);
    assert.deepEqual(await footprint(f), before);
  }
});

test("stale task edits, superseded rounds and duplicate decisions produce conflicts", async () => {
  const f = await fixture("optimistic fencing");
  const initial = await details(f);
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 200, { name: "Changed before request" });
  await submit(f, { state: initial, status: 409 });
  await submit(f);
  const firstRound = await details(f, f.approver);
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 200, { description: "Changed before approval" });
  await act(f, "approve", { cookie: f.approver, state: firstRound, status: 409 });
  const updatedRound = await details(f, f.approver);
  await act(f, "request_changes", { cookie: f.approver, state: updatedRound, comment: "Review again" });
  await act(f, "resubmit", { approver_id: f.approverId });
  await act(f, "approve", { cookie: f.approver, state: updatedRound, status: 409 });
  const approved = await act(f, "approve", { cookie: f.approver });
  await act(f, "approve", { cookie: f.approver, state: approved, status: 409 });
  assert.equal((await details(f)).history.length, 4);
});

test("concurrent opposite decisions commit exactly once with one history and notification", async () => {
  const f = await fixture("concurrent decisions");
  await submit(f);
  const pending = await details(f, f.approver);
  const responses = await Promise.all(["approve", "reject"].map((action) => http(f.path, {
    cookie: f.approver, method: "POST", json: { action, comment: "Concurrent decision", ...version(pending) }, timeout: 10_000,
  })));
  const bodies = await Promise.all(responses.map((r) => r.text()));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409], bodies.join("\n"));
  const current = await details(f);
  assert.equal(current.approval.version, 2);
  assert.equal(current.history.length, 2);
  assert.equal((await taskState(f)).completed, current.approval.status === "approved");
  const { rows: [counts] } = await db.query(
    `SELECT (SELECT count(*)::int FROM task_approval_history WHERE task_id=$1 AND version=2) AS decisions,
      (SELECT count(*)::int FROM task_events WHERE task_id=$1 AND kind IN ('approval_approve','approval_reject')) AS events,
      (SELECT count(*)::int FROM task_event_recipients r JOIN task_events e ON e.id=r.event_id
       WHERE e.task_id=$1 AND e.kind IN ('approval_approve','approval_reject') AND r.user_id=$2) AS notifications`,
    [f.id, f.requesterId],
  );
  assert.deepEqual(counts, { decisions: 1, events: 1, notifications: 1 });
});

test("permission revocation is rechecked before decisions and requests from secondary homes", async () => {
  const f = await fixture("current authorization");
  await submit(f);
  const pending = await details(f, f.approver);
  await db.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2", [f.a, f.approverId]);
  await request(f.approver, "POST", f.path, 403, { action: "approve", ...version(pending) });
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.a, f.requesterId]);
  await request(f.requester, "POST", f.path, 403, { action: "reassign", approver_id: f.peerId, ...version(pending) });

  const shared = await task(f.a, "Secondary-home approval scope");
  await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [shared, f.b]);
  await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')", [f.b, f.outsiderId]);
  const scoped = { ...f, id: shared, path: `/api/tasks/${shared}/approval` };
  const view = await details(scoped, f.outsider);
  assert.equal(view.can_request, false);
  await submit(scoped, { cookie: f.outsider, state: view, status: 403 });
  assert.equal((await details(f, f.owner)).approval.status, "pending");
});

test("deleted tasks cannot receive approval decisions", async () => {
  const f = await fixture("deleted task");
  await submit(f);
  const pending = await details(f, f.approver);
  await request(f.owner, "DELETE", `/api/tasks/${f.id}`, 200);
  await request(f.approver, "GET", f.path, 404);
  await request(f.approver, "POST", f.path, 404, { action: "approve", ...version(pending) });
});

test("normal PATCH and mixed bulk completion cannot bypass approval or partially complete other tasks", async () => {
  const f = await fixture("completion bypass");
  await submit(f);
  const normal = await task(f.a, "Normal task in atomic bulk");
  for (const op of ["complete", "reopen"]) {
    await request(f.requester, "POST", "/api/tasks/bulk", 409, { ids: [normal, f.id], op });
    assert.equal((await db.query("SELECT completed FROM tasks WHERE id=$1", [normal])).rows[0].completed, false);
  }
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 409, { completed: true });
  await act(f, "approve", { cookie: f.approver });
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 409, { completed: false });
  assert.equal((await taskState(f)).completed, true);
  const again = await act(f, "resubmit", { approver_id: f.approverId });
  assert.equal(again.approval.status, "pending");
  assert.equal((await taskState(f)).completed, false);
});

test("automation capability task.complete cannot mark a pending approval complete", async () => {
  const f = await fixture("automation completion guard");
  await submit(f);
  const before = await footprint(f);
  // Exercise the actual capability transaction, without assuming how the
  // engine classifies a capability rejection in its existing retry policy.
  await assert.rejects(executeCapability("task.complete", { task_id: f.id }, {
    actorId: f.requesterId, source: "automation", projectId: f.a, chainDepth: 0,
  }), (error) => error?.status === 409);
  assert.deepEqual(await footprint(f), before);
  assert.equal((await taskState(f)).completed, false);
  assert.equal((await details(f)).approval.status, "pending");
});

test("milestone and recurring tasks cannot become approvals, and approval tasks cannot gain those flags", async () => {
  const f = await fixture("exclusive task kinds");
  await db.query("UPDATE tasks SET is_milestone=true WHERE id=$1", [f.id]);
  await submit(f, { status: 409 });
  await db.query("UPDATE tasks SET is_milestone=false,recurrence='daily' WHERE id=$1", [f.id]);
  await submit(f, { status: 409 });
  await db.query("UPDATE tasks SET recurrence='none' WHERE id=$1", [f.id]);
  await submit(f);
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 409, { is_milestone: true });
  await request(f.requester, "PATCH", `/api/tasks/${f.id}`, 409, { recurrence: "daily" });
  assert.equal((await taskState(f)).is_milestone, false);
  assert.equal((await taskState(f)).recurrence, "none");
});

test("database constraints reject completion and task-kind bypasses even without the API", async () => {
  const f = await fixture("database invariant");
  await submit(f);
  for (const set of ["completed=true,completed_at=now()", "is_milestone=true", "recurrence='daily'"]) {
    await assert.rejects(db.query(`UPDATE tasks SET ${set} WHERE id=$1`, [f.id]),
      (error) => error?.code === "23514", `constraint must reject ${set}`);
  }
  assert.equal((await taskState(f)).completed, false);
  assert.equal((await details(f)).approval.status, "pending");
});

test("failed history persistence rolls back the decision, completion, events and notifications atomically", async () => {
  const f = await fixture("decision rollback");
  await submit(f);
  const before = await footprint(f);
  const name = `approval_fail_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced approval history rollback' USING ERRCODE='P0001'; END $$;
      CREATE TRIGGER ${name} BEFORE INSERT ON task_approval_history FOR EACH ROW
      WHEN (NEW.task_id=${f.id} AND NEW.version=2) EXECUTE FUNCTION ${name}()`);
    await act(f, "approve", { cookie: f.approver, status: 500 });
    assert.deepEqual(await footprint(f), before);
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS ${name} ON task_approval_history; DROP FUNCTION IF EXISTS ${name}()`);
  }
  await act(f, "approve", { cookie: f.approver });
});

test("approval inbox entries are targeted, remain readable through the existing read contract and disappear after access loss", async () => {
  const f = await fixture("targeted inbox");
  await submit(f);
  const { rows: [event] } = await db.query("SELECT id FROM task_events WHERE task_id=$1 AND kind='approval_request'", [f.id]);
  const addressed = (await getInbox(f.approverId, 1)).filter((item) => Number(item.task_id) === f.id && item.entry === "event");
  assert.equal(addressed.filter((item) => Number(item.id) === Number(event.id)).length, 1);
  assert.ok(await getUnreadCount(f.approverId, 1) >= 1);
  for (const person of [f.peerId, f.viewerId, f.outsiderId]) {
    assert.equal((await getInbox(person, 1)).filter((item) => Number(item.task_id) === f.id && item.entry === "event").length, 0);
  }
  await request(f.approver, "POST", "/api/inbox/read", 200, { event_id: Number(event.id) });
  const read = (await getInbox(f.approverId, 1)).find((item) => item.entry === "event" && Number(item.id) === Number(event.id));
  assert.equal(read?.is_read, true);
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.a, f.approverId]);
  assert.equal((await getInbox(f.approverId, 1)).filter((item) => Number(item.task_id) === f.id).length, 0);
});

test("task and project copies never inherit approval decisions, pending rounds or completion", async () => {
  const f = await fixture("copy isolation");
  await submit(f);
  await act(f, "approve", { cookie: f.approver });
  const copy = await request(f.requester, "POST", `/api/tasks/${f.id}/duplicate`, 201);
  const state = await request(f.requester, "GET", `/api/tasks/${copy.id}/approval`, 200);
  assert.equal(state.approval, null);
  assert.equal((await db.query("SELECT completed FROM tasks WHERE id=$1", [copy.id])).rows[0].completed, false);
  await request(f.requester, "PATCH", `/api/tasks/${copy.id}`, 200, { name: "Unapproved task copy" });
  const project = await request(f.owner, "POST", `/api/projects/${f.a}/duplicate`, 201, { name: "Approval copy isolation" });
  const rows = (await db.query(
    `SELECT t.id,t.name,t.completed,a.task_id AS approval FROM tasks t LEFT JOIN task_approvals a ON a.task_id=t.id
     WHERE t.project_id=$1 AND t.name=ANY($2::text[])`, [project.id, ["copy isolation", "Unapproved task copy"]],
  )).rows;
  assert.equal(rows.length, 2);
  for (const name of ["copy isolation", "Unapproved task copy"]) {
    const row = rows.find((item) => item.name === name);
    assert.ok(row, `project copy contains ${name}`);
    assert.equal(row.completed, false);
    assert.equal(row.approval, null);
    assert.ok(![f.id, Number(copy.id)].includes(Number(row.id)));
  }
  assert.equal((await details(f)).approval.status, "approved");
});

test("approval migration is repeatable and preserves existing normal tasks and approval history", async () => {
  const f = await fixture("migration repeatability");
  await submit(f);
  const normal = await task(f.a, "Unchanged normal task");
  const before = await footprint(f);
  const normalBefore = (await db.query("SELECT to_jsonb(t) AS row FROM tasks t WHERE id=$1", [normal])).rows[0].row;
  const sql = await readFile(new URL("../db/migrations/0016_task_approvals.sql", import.meta.url), "utf8");
  await db.query(sql);
  await db.query(sql);
  assert.deepEqual(await footprint(f), before);
  assert.deepEqual((await db.query("SELECT to_jsonb(t) AS row FROM tasks t WHERE id=$1", [normal])).rows[0].row, normalBefore);
});
