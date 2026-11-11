import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { createClient } from "redis";
// Rejects every DATABASE_URL except the runner's isolated atlas_p0 database.
import { db, fixtures, http, request, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function fixture(label, count = 3) {
  const f = await fixtures(`EV03 ${label} ${randomUUID()}`);
  const { rows } = await db.query(
    `INSERT INTO tasks (project_id,name,created_by,assignee_id,due_on,position)
     SELECT $1, 'EV03 task ' || i, $2, $2, DATE '2026-11-11', i * 1000
     FROM generate_series(1,$3::int) i RETURNING id`,
    [f.a, f.ownerId, count],
  );
  return { ...f, ids: rows.map((row) => Number(row.id)) };
}

async function tasksState(ids) {
  return (await db.query("SELECT to_jsonb(t) AS task FROM tasks t WHERE id=ANY($1::bigint[]) ORDER BY id", [ids])).rows;
}

async function orderState(f) {
  return (await db.query("SELECT task_id,position,updated_at::text FROM my_task_orders WHERE user_id=$1 ORDER BY task_id", [f.ownerId])).rows;
}

async function footprint(ids) {
  const shared = await tasksState(ids);
  const events = (await db.query(
    `SELECT (SELECT count(*)::int FROM domain_events WHERE subject_type='task' AND subject_id=ANY($1::bigint[])) AS domain,
      (SELECT count(*)::int FROM task_events WHERE task_id=ANY($1::bigint[])) AS history,
      (SELECT count(*)::int FROM task_approval_history WHERE task_id=ANY($1::bigint[])) AS approvals`,
    [ids],
  )).rows[0];
  return { shared, events };
}

const snapshot = (f) => request(f.owner, "GET", "/api/my-tasks", 200);
const move = (f, value, status = 200) => request(f.owner, "PUT", "/api/my-tasks", status, { move: value });

test("EV03 personal ordering changes no shared task field, version, history or domain event", async () => {
  const f = await fixture("order isolation");
  const before = await footprint(f.ids);
  await move(f, { task_id: f.ids[2], before_task_id: f.ids[0] });
  assert.deepEqual((await snapshot(f)).items.map((item) => item.task_id), [f.ids[2], f.ids[0], f.ids[1]]);
  assert.deepEqual(await footprint(f.ids), before);
  const ordered = await orderState(f);
  const same = await move(f, { task_id: f.ids[2], before_task_id: f.ids[0] });
  assert.equal(same.changed, 0);
  assert.deepEqual(await orderState(f), ordered, "same-position move does not touch order timestamps either");
});

test("EV03 unchanged legacy date snapshots remain compatible but stale dates reject the entire order batch", async () => {
  const f = await fixture("legacy snapshots", 2);
  const items = f.ids.map((task_id, index) => ({ task_id, position: (index + 1) * 1000, due_on: "2026-11-11" }));
  const before = await footprint(f.ids);
  const reordered = await request(f.owner, "PUT", "/api/my-tasks", 200, { items });
  assert.equal(reordered.count, 2);
  assert.deepEqual(await footprint(f.ids), before);
  const old = (await snapshot(f)).items[0];
  await request(f.editor, "PATCH", `/api/tasks/${old.task_id}`, 200, {
    due_on: "2026-11-20", expected_updated_at: old.updated_at,
  });
  const current = await footprint(f.ids);
  const orders = await orderState(f);
  await request(f.owner, "PUT", "/api/my-tasks", 409, {
    items: items.map((item, index) => ({ ...item, position: (2 - index) * 1000 })),
  });
  assert.deepEqual(await footprint(f.ids), current, "a stale full-list payload cannot restore old dates or versions");
  assert.deepEqual(await orderState(f), orders, "a rejected date assertion writes no partial order");
});

test("EV03 one changed task uses optimistic locking, due domain events, history and project notification", async () => {
  const f = await fixture("shared date path", 2);
  const previous = await tasksState(f.ids);
  const current = (await snapshot(f)).items.find((item) => item.task_id === f.ids[0]);
  // A Redis subscription is permitted only inside the same disposable network.
  assert.equal(process.env.REDIS_URL, "redis://redis:6379");
  const subscriber = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3_000, reconnectStrategy: false } });
  subscriber.on("error", () => undefined);
  await subscriber.connect();
  let received;
  let timer;
  const notified = new Promise((resolve, reject) => {
    received = resolve;
    timer = setTimeout(() => reject(new Error("versioned date update did not notify its project")), 3_000);
  });
  void notified.catch(() => undefined);
  try {
    await subscriber.subscribe("atlas:live", (raw) => {
      const event = JSON.parse(raw);
      if (Number(event.projectId) === f.a) received();
    });
    await request(f.owner, "PATCH", `/api/tasks/${current.task_id}`, 200, {
      due_on: "2026-11-21", expected_updated_at: current.updated_at,
    });
    await notified;
  } finally {
    clearTimeout(timer);
    subscriber.destroy();
  }
  const next = await snapshot(f);
  const changed = next.items.find((item) => item.task_id === current.task_id);
  assert.equal(changed.due_on, "2026-11-21");
  assert.notEqual(changed.updated_at, current.updated_at);
  assert.deepEqual((await tasksState([f.ids[1]]))[0], previous[1], "unmoved tasks keep their full row and version");
  const domain = (await db.query("SELECT type,data FROM domain_events WHERE subject_type='task' AND subject_id=$1 ORDER BY id", [current.task_id])).rows;
  assert.equal(domain.filter((event) => event.type === "task.due_changed").length, 1);
  const history = (await db.query("SELECT kind FROM task_events WHERE task_id=$1", [current.task_id])).rows;
  assert.ok(history.some((event) => event.kind === "due_changed"));
  const committed = await footprint(f.ids);
  await request(f.owner, "PATCH", `/api/tasks/${current.task_id}`, 409, {
    due_on: "2026-11-22", expected_updated_at: current.updated_at,
  });
  assert.deepEqual(await footprint(f.ids), committed, "stale date edits neither overwrite nor emit duplicate events");
  // The returned snapshot supplies the new date and version together for a
  // second deliberate bucket move, rather than pairing a fresh stamp with old UI.
  await request(f.owner, "PATCH", `/api/tasks/${changed.task_id}`, 200, {
    due_on: null, expected_updated_at: changed.updated_at,
  });
  assert.equal((await snapshot(f)).items.find((item) => item.task_id === changed.task_id).due_on, null);
});

test("EV03 a viewer may order personal tasks but cannot change shared dates", async () => {
  const f = await fixture("viewer", 2);
  await db.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2", [f.a, f.ownerId]);
  await move(f, { task_id: f.ids[1], before_task_id: f.ids[0] });
  const current = (await snapshot(f)).items[0];
  const before = await footprint(f.ids);
  await request(f.owner, "PATCH", `/api/tasks/${current.task_id}`, 403, {
    due_on: null, expected_updated_at: current.updated_at,
  });
  await request(f.owner, "PUT", "/api/my-tasks", 409, {
    items: [{ task_id: current.task_id, position: 1, due_on: null }],
  });
  assert.deepEqual(await footprint(f.ids), before);
});

test("EV03 relative intent supports 501 tasks, near/far/no-op moves and rejects legacy 501-item batches", async () => {
  const f = await fixture("501 tasks", 501);
  const before = await footprint(f.ids);
  assert.equal((await snapshot(f)).items.length, 501);
  await move(f, { task_id: f.ids[500], before_task_id: f.ids[0] });
  assert.deepEqual((await snapshot(f)).items.map((item) => item.task_id), [f.ids[500], ...f.ids.slice(0, 500)]);
  const near = await move(f, { task_id: f.ids[1], before_task_id: f.ids[0] });
  assert.equal(near.changed, 2, "an adjacent reorder only rewrites two existing order rows");
  await move(f, { task_id: f.ids[500] });
  const orders = await orderState(f);
  await move(f, { task_id: f.ids[500] });
  assert.deepEqual(await orderState(f), orders);
  await request(f.owner, "PUT", "/api/my-tasks", 400, {
    items: f.ids.map((task_id, index) => ({ task_id, position: index * 1000 })),
  });
  assert.deepEqual(await orderState(f), orders);
  assert.deepEqual(await footprint(f.ids), before);
  const page = await http("/my-tasks", { cookie: f.owner, timeout: 15_000 });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, new RegExp(`data-my-task-row="${f.ids[500]}"`));
  assert.doesNotMatch(html, /data-my-task-order-limit/);
});

test("EV03 deleted, reassigned, completed and foreign-assignee move targets fail without partial personal writes", async () => {
  const f = await fixture("eligibility", 4);
  await move(f, { task_id: f.ids[3], before_task_id: f.ids[0] });
  await db.query("UPDATE tasks SET deleted_at=now(),updated_at=now() WHERE id=$1", [f.ids[0]]);
  await db.query("UPDATE tasks SET assignee_id=$2,updated_at=now() WHERE id=$1", [f.ids[1], f.editorId]);
  await db.query("UPDATE tasks SET completed=true,completed_at=now(),updated_at=now() WHERE id=$1", [f.ids[2]]);
  const previous = await footprint(f.ids);
  const orders = await orderState(f);
  for (const unavailable of f.ids.slice(0, 3)) {
    await move(f, { task_id: unavailable, before_task_id: f.ids[3] }, 409);
    await move(f, { task_id: f.ids[3], after_task_id: unavailable }, 409);
  }
  await request(f.owner, "PUT", "/api/my-tasks", 400, { items: [{ task_id: f.ids[1], position: 1 }] });
  assert.deepEqual((await snapshot(f)).items.map((item) => item.task_id), [f.ids[3]]);
  assert.deepEqual(await footprint(f.ids), previous);
  assert.deepEqual(await orderState(f), orders);
});

test("EV03 concurrent same-user moves compose without dropping either relative intent", async () => {
  const f = await fixture("concurrent moves", 4);
  const [a, b, c, d] = f.ids;
  const before = await footprint(f.ids);
  await Promise.all([
    move(f, { task_id: d, before_task_id: a }),
    move(f, { task_id: c, before_task_id: b }),
  ]);
  assert.deepEqual((await snapshot(f)).items.map((item) => item.task_id), [d, a, c, b]);
  assert.deepEqual(await footprint(f.ids), before);
});

test("EV03 approval tasks retain their protected mutations and approval history on order/date operations", async () => {
  const f = await fixture("approval", 2);
  const id = f.ids[0];
  const state = await request(f.owner, "GET", `/api/tasks/${id}/approval`, 200);
  await request(f.owner, "POST", `/api/tasks/${id}/approval`, 200, {
    action: "request", approver_id: Number(f.editorId), expected_version: 0, expected_updated_at: state.task_updated_at,
  });
  const approval = (await db.query("SELECT to_jsonb(a) AS approval FROM task_approvals a WHERE task_id=$1", [id])).rows[0];
  const current = (await snapshot(f)).items.find((item) => item.task_id === id);
  await request(f.owner, "PATCH", `/api/tasks/${id}`, 409, {
    completed: true, expected_updated_at: current.updated_at,
  });
  await request(f.owner, "PUT", "/api/my-tasks", 400, { move: { task_id: id, completed: true } });
  await request(f.owner, "PUT", "/api/my-tasks", 409, { items: [{ task_id: id, position: 1, due_on: null }] });
  const beforeOrder = await footprint(f.ids);
  await move(f, { task_id: f.ids[1], before_task_id: id });
  assert.deepEqual(await footprint(f.ids), beforeOrder);
  // Approval policy allows date edits; it forbids bypassing the decision state.
  await request(f.owner, "PATCH", `/api/tasks/${id}`, 200, {
    due_on: null, expected_updated_at: current.updated_at,
  });
  assert.deepEqual((await db.query("SELECT to_jsonb(a) AS approval FROM task_approvals a WHERE task_id=$1", [id])).rows[0], approval);
  const row = (await db.query("SELECT completed,due_on FROM tasks WHERE id=$1", [id])).rows[0];
  assert.equal(row.completed, false);
  assert.equal(row.due_on, null);
});

test("EV03 My Tasks snapshot and mutations require an active user session", async () => {
  await request(undefined, "GET", "/api/my-tasks", 401);
  await request(undefined, "PUT", "/api/my-tasks", 401, { move: { task_id: 1 } });
});
