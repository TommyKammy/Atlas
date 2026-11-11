import assert from "node:assert/strict";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";
import { processNotificationEmails, requeueNotificationEmails } from "../lib/notification-email-worker.mjs";
import { notificationMailConfig } from "../lib/notification-mail.mjs";

before(waitForHttp);
// A transport is always injected: this suite must never contact SMTP.
const config = notificationMailConfig({ SMTP_HOST: "mock.invalid", APP_URL: "http://atlas.test" });
const accepted = async (mail) => ({ accepted: [mail.to] });
async function comment(taskId, author, body, at = null) {
  const { rows: [row] } = await db.query(`INSERT INTO comments(task_id,author_id,body,created_at)
    VALUES($1,$2,$3,coalesce($4::timestamptz,clock_timestamp())) RETURNING id`, [taskId, author, body, at]);
  return Number(row.id);
}
async function event(taskId, actor, kind = "changed") {
  return Number((await db.query("INSERT INTO task_events(task_id,actor_id,kind,summary) VALUES($1,$2,$3,'notification event') RETURNING id",
    [taskId, actor, kind])).rows[0].id);
}
async function source(commentId) {
  return Number((await db.query("SELECT id FROM notification_email_sources WHERE comment_id=$1", [commentId])).rows[0].id);
}
async function recipient(f, project = f.a, role = "viewer") {
  const { rows: [u] } = await db.query("INSERT INTO users(name,email) VALUES('EV10 recipient',$1) RETURNING id",
    [`ev10-${f.a}-${project}-${role}@example.test`]);
  await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3)", [project, u.id, role]);
  return { id: Number(u.id), cookie: await session(u.id), email: `ev10-${f.a}-${project}-${role}@example.test` };
}
async function feed(cookie, filter = "unread", cursor = null) {
  return request(cookie, "GET", `/api/inbox?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, 200);
}
async function delivery(sourceId, userId) {
  return (await db.query("SELECT * FROM notification_email_deliveries WHERE source_id=$1 AND user_id=$2", [sourceId, userId])).rows[0];
}
async function expandOnly(sourceId) {
  let checks = 0;
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 1, config, sendMail: accepted, shouldStop: () => ++checks > 1 });
}

test("EV10 unread filtering precedes paging and every same-timestamp entry remains reachable", async () => {
  const f = await fixtures("EV10 pagination");
  const t = await task(f.a, "pagination task");
  const old = await comment(t, f.ownerId, "old unread", "2020-01-01T00:00:00.000001Z");
  await db.query(`WITH new_comments AS (INSERT INTO comments(task_id,author_id,body,created_at)
    SELECT $1,$2,'new read '||n,'2026-01-01'::timestamptz FROM generate_series(1,110) n RETURNING id)
    INSERT INTO inbox_reads(comment_id,user_id) SELECT id,$3 FROM new_comments`, [t, f.ownerId, f.editorId]);
  let page = await feed(f.editor);
  assert.equal(page.total, 1);
  assert.equal(page.unread, 1);
  assert.equal(Number(page.items[0].id), old);
  const ids = (await db.query(`INSERT INTO comments(task_id,author_id,body,created_at)
    SELECT $1,$2,'same timestamp '||n,'2026-11-11T00:00:00.123456Z'::timestamptz
    FROM generate_series(1,121) n RETURNING id`, [t, f.ownerId])).rows.map((r) => `comment-${r.id}`);
  const e = await event(t, f.ownerId);
  await db.query("UPDATE task_events SET created_at='2026-11-11T00:00:00.123456Z' WHERE id=$1", [e]);
  ids.push(`comment-${old}`, `event-${e}`);
  const own = await comment(t, f.editorId, "my own comment");
  const seen = [];
  let cursor = null;
  do {
    page = await feed(f.editor, "unread", cursor);
    assert.equal(page.total, ids.length);
    seen.push(...page.items.map((item) => `${item.entry}-${item.id}`));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, ids.length);
  assert.deepEqual(new Set(seen), new Set(ids));
  const read = await feed(f.editor, "read");
  assert.equal(read.total, 111);
  assert.ok(read.items.some((item) => Number(item.id) === own));
  await request(f.editor, "POST", "/api/inbox/read", 200, { all: true, workspace_id: 1 });
  assert.equal((await feed(f.editor)).total, 0);
  assert.equal((await http("/api/inbox?cursor=invalid", { cookie: f.editor })).status, 400);
  assert.equal((await http("/api/inbox")).status, 401);
});

test("EV10 in-app preferences immediately affect feed, counts and read authorization", async () => {
  const f = await fixtures("EV10 preferences");
  const t = await task(f.a, "preference task");
  const c = await comment(t, f.ownerId, "preference comment");
  assert.equal((await feed(f.editor)).unread, 1);
  await db.query(`UPDATE projects SET settings='{"notifications":{"in_app":false}}' WHERE id=$1`, [f.a]);
  assert.equal((await feed(f.editor, "all")).all, 0);
  await request(f.editor, "POST", "/api/inbox/read", 404, { comment_id: c });
  for (const invalid of ["false", [], {}, null, 1]) {
    await db.query("UPDATE projects SET settings=jsonb_build_object('notifications',jsonb_build_object('in_app',$2::jsonb)) WHERE id=$1",
      [f.a, JSON.stringify(invalid)]);
    assert.equal((await feed(f.editor)).unread, 1, "nonboolean values use the existing default, without SQL casts failing");
  }
  await request(f.editor, "POST", "/api/inbox/read", 200, { comment_id: c });
  await request(f.editor, "POST", "/api/inbox/read", 200, { comment_id: c });
  assert.equal((await feed(f.editor)).unread, 0);
});

test("EV10 multi-home and inherited read scope match project pages, never legacy incompatible parents", async () => {
  const f = await fixtures("EV10 homes");
  const viewer = await recipient(f, f.b);
  const parent = await task(f.a, "shared parent");
  await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [parent, f.b]);
  const compatible = await task(f.a, "compatible child", parent);
  const projectless = await task(null, "projectless child", parent);
  const { rows: [third] } = await db.query("INSERT INTO projects(workspace_id,name) VALUES(1,'EV10 legacy C') RETURNING id");
  const client = await db.connect();
  let legacy;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    legacy = Number((await client.query("INSERT INTO tasks(project_id,name,parent_task_id) VALUES($1,'legacy child',$2) RETURNING id",
      [third.id, parent])).rows[0].id);
    await client.query("SET LOCAL session_replication_role=origin");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const visible = [parent, compatible, projectless];
  const comments = [];
  for (const id of [...visible, legacy]) comments.push(await comment(id, f.ownerId, `home task ${id}`));
  let page = await feed(viewer.cookie);
  assert.deepEqual(new Set(page.items.map((item) => Number(item.task_id))), new Set(visible));
  assert.ok(page.items.every((item) => Number(item.project_id) === f.b));
  await request(viewer.cookie, "POST", "/api/inbox/read", 404, { comment_id: comments[3] });
  const sent = [];
  const sourceIds = (await db.query("SELECT id FROM notification_email_sources WHERE comment_id=ANY($1::bigint[])", [comments])).rows.map((r) => r.id);
  await processNotificationEmails(db, { sourceIds, limit: 20, config, sendMail: async (mail) => { sent.push(mail); return accepted(mail); } });
  assert.equal(sent.filter((mail) => mail.to === viewer.email).length, 3);
  await db.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [legacy, f.b]);
  page = await feed(viewer.cookie);
  assert.equal(page.total, 4, "explicit homes remain valid even on incompatible legacy edges");
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.b, viewer.id]);
  assert.equal((await feed(viewer.cookie, "all")).total, 0);
});

test("EV10 approval notifications stay recipient-only even for project administrators", async () => {
  const f = await fixtures("EV10 approval");
  const target = await recipient(f);
  const t = await task(f.a, "approval notification");
  const e = await event(t, f.ownerId, "approval_requested");
  await db.query("INSERT INTO task_event_recipients(event_id,user_id) VALUES($1,$2)", [e, target.id]);
  assert.equal((await feed(target.cookie)).total, 1);
  assert.equal((await feed(f.editor, "all")).total, 0);
  assert.equal((await feed(f.owner, "all")).total, 0);
  const sourceId = Number((await db.query("SELECT id FROM notification_email_sources WHERE event_id=$1", [e])).rows[0].id);
  const sent = [];
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config,
    sendMail: async (mail) => { sent.push(mail); return accepted(mail); } });
  assert.deepEqual(sent.map((mail) => mail.to), [target.email]);
});

test("EV10 missing SMTP never fails task writes and only explicit retry releases unconfigured mail", async () => {
  const f = await fixtures("EV10 unconfigured");
  const target = await recipient(f);
  const t = await task(f.a, "SMTP missing");
  const created = await request(f.owner, "POST", "/api/comments", 201, { task_id: t, body: "task write survives missing SMTP" });
  const sourceId = await source(created.id);
  const sent = [];
  const sendMail = async (mail) => { sent.push(mail); return accepted(mail); };
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config: notificationMailConfig({}), sendMail });
  let row = await delivery(sourceId, target.id);
  assert.equal(row.status, "unconfigured");
  assert.equal(row.attempts, 0);
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config, sendMail });
  assert.equal(sent.length, 0, "adding configuration alone must not unexpectedly send accumulated mail");
  assert.ok(await requeueNotificationEmails(db, f.a) > 0);
  await Promise.all([1, 2].map(() => processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config, sendMail })));
  row = await delivery(sourceId, target.id);
  assert.equal(row.status, "sent");
  assert.equal(sent.filter((mail) => mail.to === target.email).length, 1);
  assert.match(sent[0].messageId, /^<atlas-notification-/);
  assert.equal(await requeueNotificationEmails(db, f.a), 0);
  const settings = await request(f.owner, "GET", `/api/projects/${f.a}/settings`, 200);
  assert.equal(typeof settings.notification_delivery.smtp_configured, "boolean");
  assert.equal(settings.notification_delivery.worker_running, false, "isolated API runner has workers disabled");
  assert.equal(JSON.stringify(settings.notification_delivery).includes("smtp.test"), false);
  await request(target.cookie, "POST", `/api/projects/${f.a}/notifications/retry`, 403, {});
});

test("EV10 queued recipients are revalidated after opt-out, role revocation and deletion", async () => {
  for (const mutation of ["opt-out", "membership", "deactivated", "task-deleted", "project-deleted"]) {
    const f = await fixtures(`EV10 revoke ${mutation}`);
    const target = await recipient(f);
    const t = await task(f.a, `queued ${mutation}`);
    const sourceId = await source(await comment(t, f.ownerId, "queued"));
    await expandOnly(sourceId);
    assert.equal((await delivery(sourceId, target.id)).status, "pending");
    if (mutation === "opt-out") await db.query(`UPDATE projects SET settings='{"notifications":{"email":false}}' WHERE id=$1`, [f.a]);
    if (mutation === "membership") await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.a, target.id]);
    if (mutation === "deactivated") await db.query("UPDATE users SET deactivated_at=now() WHERE id=$1", [target.id]);
    if (mutation === "task-deleted") await db.query("UPDATE tasks SET deleted_at=now() WHERE id=$1", [t]);
    if (mutation === "project-deleted") await db.query("UPDATE projects SET deleted_at=now() WHERE id=$1", [f.a]);
    const sent = [];
    await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config,
      sendMail: async (mail) => { sent.push(mail); return accepted(mail); } });
    assert.equal((await delivery(sourceId, target.id)).status, "cancelled", mutation);
    assert.equal(sent.filter((mail) => mail.to === target.email).length, 0, mutation);
  }
  const f = await fixtures("EV10 opt-out at creation");
  await db.query(`UPDATE projects SET settings='{"notifications":{"email":false}}' WHERE id=$1`, [f.a]);
  const c = await comment(await task(f.a, "no email source"), f.ownerId, "muted");
  assert.equal((await db.query("SELECT id FROM notification_email_sources WHERE comment_id=$1", [c])).rowCount, 0);
});

test("EV10 SMTP failure retries are bounded and an expired in-flight lease is never automatically resent", async () => {
  const f = await fixtures("EV10 retry");
  const target = await recipient(f);
  const sourceId = await source(await comment(await task(f.a, "retry"), f.ownerId, "retry"));
  const messageIds = [];
  const reject = async (mail) => { if (mail.to === target.email) messageIds.push(mail.messageId); throw new Error("mock rejection"); };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config, sendMail: reject });
    const row = await delivery(sourceId, target.id);
    assert.equal(row.attempts, attempt);
    assert.equal(row.status, attempt === 3 ? "failed" : "retry");
    await db.query("UPDATE notification_email_deliveries SET retry_at=clock_timestamp()-interval '1 second' WHERE source_id=$1", [sourceId]);
  }
  assert.equal(new Set(messageIds).size, 1);
  await requeueNotificationEmails(db, f.a);
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const captured = [];
  const blocked = processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config, sendMail: async (mail) => {
    captured.push(mail);
    if (mail.to === target.email) { entered(); await barrier; }
    return accepted(mail);
  } });
  try {
    await Promise.race([started, delay(3000).then(() => assert.fail("mock transport was not reached"))]);
    await db.query("UPDATE notification_email_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE source_id=$1 AND user_id=$2", [sourceId, target.id]);
    await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config,
      sendMail: async (mail) => { captured.push(mail); return accepted(mail); } });
    const row = await delivery(sourceId, target.id);
    assert.equal(row.status, "failed");
    assert.equal(row.last_error, "DELIVERY_STATUS_UNKNOWN");
    assert.equal(captured.filter((mail) => mail.to === target.email).length, 1);
  } finally { release(); await blocked; }
  assert.equal((await delivery(sourceId, target.id)).status, "failed", "stale successful sender must not overwrite unknown status");
});

test("EV10 project deletion and email expansion acquire the same gate before row locks", async () => {
  const f = await fixtures("EV10 deletion gate");
  await recipient(f);
  const sourceId = await source(await comment(await task(f.a, "delete while expanding"), f.ownerId, "gate"));
  const deletion = await db.connect();
  const worker = await db.connect();
  const pid = Number((await worker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let running;
  try {
    await deletion.query("BEGIN");
    await deletion.query("SELECT pg_advisory_xact_lock(1096043603,2)");
    await deletion.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [f.a]);
    running = processNotificationEmails({ connect: async () => ({ query: worker.query.bind(worker), release() {} }), query: db.query.bind(db) },
      { sourceIds: [sourceId], limit: 1, config, sendMail: accepted });
    const deadline = Date.now() + 3000;
    while (!(await db.query(`SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory'
      AND classid=1096043603 AND objid=2 AND NOT granted`, [pid])).rowCount) {
      assert.ok(Date.now() < deadline, "worker must wait on shared gate before locking its source");
      await delay(10);
    }
    await deletion.query("DELETE FROM projects WHERE id=$1", [f.a]);
    await deletion.query("COMMIT");
    await running;
    assert.equal((await db.query("SELECT id FROM notification_email_sources WHERE id=$1", [sourceId])).rowCount, 0);
  } finally {
    await deletion.query("ROLLBACK").catch(() => {});
    await running;
    worker.release(); deletion.release();
  }
});

test("EV10 SMTP acceptance followed by a database failure is never automatically resent", async () => {
  const f = await fixtures("EV10 accepted save failure");
  const target = await recipient(f);
  const sourceId = await source(await comment(await task(f.a, "accepted save failure"), f.ownerId, "accepted"));
  await expandOnly(sourceId);
  const row = await delivery(sourceId, target.id);
  let failedOnce = false;
  const pool = { connect: db.connect.bind(db), query: async (sql, params) => {
    if (!failedOnce && params?.[2] === "sent" && Number(params[0]) === Number(row.id)) {
      failedOnce = true;
      throw new Error("mock database failure after SMTP acceptance");
    }
    return db.query(sql, params);
  } };
  const captured = [];
  const sendMail = async (mail) => { captured.push(mail); return accepted(mail); };
  await processNotificationEmails(pool, { sourceIds: [sourceId], limit: 20, config, sendMail });
  assert.equal(failedOnce, true);
  assert.equal((await delivery(sourceId, target.id)).status, "failed");
  assert.equal((await delivery(sourceId, target.id)).last_error, "DELIVERY_STATUS_UNKNOWN");
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 20, config, sendMail });
  assert.equal(captured.filter((mail) => mail.to === target.email).length, 1);
});

test("EV10 repeated pre-send shutdowns never exhaust SMTP attempts or strand pending mail", async () => {
  const f = await fixtures("EV10 shutdown attempts");
  const target = await recipient(f);
  const sourceId = await source(await comment(await task(f.a, "shutdown attempts"), f.ownerId, "shutdown"));
  await expandOnly(sourceId);
  await db.query("UPDATE notification_email_deliveries SET status='cancelled' WHERE source_id=$1 AND user_id<>$2", [sourceId, target.id]);
  let sends = 0;
  const sendMail = async (mail) => { sends++; return accepted(mail); };
  for (let i = 0; i < 4; i++) {
    let checks = 0;
    await processNotificationEmails(db, { sourceIds: [sourceId], limit: 1, config, sendMail, shouldStop: () => ++checks >= 3 });
    const row = await delivery(sourceId, target.id);
    assert.equal(row.attempts, 0);
    assert.equal(row.status, "retry");
    assert.equal(row.last_error, "WORKER_STOPPED");
    await db.query("UPDATE notification_email_deliveries SET retry_at=clock_timestamp()-interval '1 second' WHERE id=$1", [row.id]);
  }
  assert.equal(sends, 0);
  await processNotificationEmails(db, { sourceIds: [sourceId], limit: 1, config, sendMail });
  assert.equal(sends, 1);
  assert.equal((await delivery(sourceId, target.id)).status, "sent");
});

test("EV10 a payload lookup stalled beyond its lease cannot start SMTP with a stale claim", async () => {
  const f = await fixtures("EV10 stale before SMTP");
  const target = await recipient(f);
  const sourceId = await source(await comment(await task(f.a, "stale before SMTP"), f.ownerId, "stale"));
  await expandOnly(sourceId);
  await db.query("UPDATE notification_email_deliveries SET status='cancelled' WHERE source_id=$1 AND user_id<>$2", [sourceId, target.id]);
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const pool = { connect: db.connect.bind(db), query: async (sql, params) => {
    const result = await db.query(sql, params);
    if (sql.startsWith("SELECT u.email,t.name")) { entered(); await barrier; }
    return result;
  } };
  let sends = 0;
  const sendMail = async (mail) => { sends++; return accepted(mail); };
  const running = processNotificationEmails(pool, { sourceIds: [sourceId], limit: 1, config, sendMail });
  try {
    await Promise.race([started, delay(3000).then(() => assert.fail("payload lookup did not start"))]);
    await db.query("UPDATE notification_email_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE source_id=$1 AND user_id=$2", [sourceId, target.id]);
    await processNotificationEmails(db, { sourceIds: [sourceId], limit: 1, config, sendMail });
    assert.equal((await delivery(sourceId, target.id)).last_error, "DELIVERY_STATUS_UNKNOWN");
  } finally { release(); await running; }
  assert.equal(sends, 0);
  assert.equal((await delivery(sourceId, target.id)).status, "failed");
});
