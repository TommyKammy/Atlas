import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";
import { WebSocket } from "ws";
import { hashPassword } from "../lib/auth.ts";
import { hashRecoveryCode, totpCode } from "../lib/totp.ts";
import { base, db, fixtures, http, projectOf, request, session, task, waitForHttp } from "./regression-fixtures.mjs";
import { signSamlResponse } from "./saml-assertion.mjs";

before(waitForHttp);

function cookieFrom(response) {
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith("atlas_session="))?.split(";")[0];
  assert.match(cookie ?? "", /^atlas_session=[A-Za-z0-9_-]{43}$/);
  return cookie;
}

function connect(projectId, cookie, origin) {
  const url = new URL(`/api/ws?project=${projectId}`, base);
  url.protocol = "ws:";
  const socket = new WebSocket(url, { origin, headers: { Cookie: cookie }, handshakeTimeout: 4_000 });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ status: 101, socket }));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve({ status: response.statusCode, socket });
      socket.terminate();
    });
    socket.on("error", reject);
  });
}

async function openWs(t, projectId, cookie) {
  const { status, socket } = await connect(projectId, cookie, base);
  assert.equal(status, 101);
  t.after(() => socket.terminate());
  return socket;
}

async function expectWsRejection(projectId, cookie, origin, expected) {
  const { status, socket } = await connect(projectId, cookie, origin);
  if (status === 101) socket.terminate();
  assert.equal(status, expected);
}

async function webhookRule(projectId, cookie, params) {
  const { id } = await request(cookie, "POST", `/api/projects/${projectId}/rules`, 201, {
    name: "Webhook test rule",
    definition: { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "webhook.post", params }] },
  });
  return `/api/projects/${projectId}/rules/${id}`;
}

test("R04 a project editor cannot POST to loopback through a webhook rule", { timeout: 12_000 }, async (t) => {
  const { a, editor } = await fixtures("SSRF");
  const taskId = await task(a, "Webhook trigger");
  let calls = 0;
  const target = createServer((_request, response) => {
    calls++;
    response.writeHead(204).end();
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  t.after(() => target.close());

  const rule = await webhookRule(a, editor, { url: `http://127.0.0.1:${target.address().port}/private` });
  await request(editor, "POST", `${rule}/run`, 201, { task_id: taskId });
  const { runs } = await request(editor, "GET", `${rule}/runs`, 200);
  assert.equal(runs[0]?.status, "failed");
  assert.equal(calls, 0);
});

test("R05 WebSocket upgrade requires an allowed origin and project access", { timeout: 12_000 }, async (t) => {
  const { a, b, editor, editorId } = await fixtures("Socket upgrade");
  await expectWsRejection(a, editor, "https://sibling.example.test", 403);
  await expectWsRejection(a, editor, undefined, 403);
  await expectWsRejection(b, editor, base, 403);
  await db.query("UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2", [a, editorId]);
  await openWs(t, a, editor);
});

test("R05 active sockets lose access on logout, expiry, and membership removal", { timeout: 15_000 }, async (t) => {
  const { a, owner, editor, editorId, ownerId } = await fixtures("Socket revocation");
  const socket = await openWs(t, a, editor);
  let messages = 0;
  socket.on("message", () => messages++);
  const loggedOut = once(socket, "close", { signal: AbortSignal.timeout(8_000) });
  await request(editor, "POST", "/api/auth/logout", 200);
  await request(owner, "POST", "/api/tasks", 201, { project_id: a, name: "After logout" });
  assert.equal((await loggedOut)[0], 1008);
  assert.equal(messages, 0);
  await expectWsRejection(a, editor, base, 401);

  const memberSocket = await openWs(t, a, await session(editorId));
  const expiryCookie = await session(ownerId);
  const expirySocket = await openWs(t, a, expiryCookie);
  const closed = Promise.all([memberSocket, expirySocket].map((ws) =>
    once(ws, "close", { signal: AbortSignal.timeout(8_000) }),
  ));
  await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [a, editorId]);
  const expiryHash = createHash("sha256").update(expiryCookie.split("=")[1]).digest("hex");
  await db.query("UPDATE user_sessions SET expires_at = now() WHERE token_hash = $1", [expiryHash]);
  assert.deepEqual((await closed).map(([code]) => code), [1008, 1008]);
});

test("R06 mandatory MFA restricts old and new sessions until enrollment", { timeout: 15_000 }, async (t) => {
  const { a, editor, editorId } = await fixtures("MFA enrollment");
  const email = "regression-mfa@example.test";
  const password = "Regression Fixture 2026!";
  await db.query("UPDATE users SET email = $2, password_hash = $3 WHERE id = $1", [editorId, email, hashPassword(password)]);
  await db.query("UPDATE workspace_security SET two_factor_policy = 'required' WHERE workspace_id = 1");
  t.after(() => db.query("UPDATE workspace_security SET two_factor_policy = 'optional' WHERE workspace_id = 1"));

  assert.equal((await http("/api/me", { cookie: editor })).status, 404);
  const login = await http("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).two_factor_setup_required, true);
  const pending = cookieFrom(login);
  assert.equal((await http("/api/me", { cookie: pending })).status, 404);
  await expectWsRejection(a, pending, base, 401);

  const { secret } = await request(pending, "POST", "/api/me/2fa", 200, { action: "begin" });
  const enable = await http("/api/me/2fa", {
    method: "POST", cookie: pending, json: { action: "enable", code: totpCode(secret) },
  });
  assert.equal(enable.status, 200);
  const { recovery_codes: recoveryCodes } = await enable.json();
  assert.ok(recoveryCodes.length > 0);
  const full = cookieFrom(enable);
  assert.notEqual(full, pending);
  assert.equal((await http("/api/me", { cookie: pending })).status, 404);
  assert.equal((await http("/api/me", { cookie: editor })).status, 404);
  await request(full, "GET", "/api/me", 200);
  await openWs(t, a, full);
});

test("R06 concurrent login requests can consume a recovery code only once", { timeout: 12_000 }, async () => {
  const { editorId } = await fixtures("Recovery code");
  const email = "regression-recovery@example.test";
  const password = "Regression Fixture 2026!";
  const recoveryCode = "12345-6789A";
  await db.query(
    `UPDATE users SET email = $2, password_hash = $3, totp_enabled = true, totp_recovery_codes = $4
     WHERE id = $1`,
    [editorId, email, hashPassword(password), [hashRecoveryCode(recoveryCode)]],
  );

  // Let both requests read the code before releasing the writes.
  const blocker = await db.connect();
  let logins;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE users IN SHARE MODE");
    const login = () => http("/api/auth/login", { method: "POST", json: { email, password, recovery_code: recoveryCode } });
    logins = Promise.all([login(), login()]);
    void logins.catch(() => undefined);
    const deadline = Date.now() + 3_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const { rows: [{ n }] } = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE '%totp_recovery_codes%'`,
      );
      waiting = n;
      if (waiting >= 2) break;
      await delay(30);
    }
    assert.ok(waiting >= 2, "Both recovery requests must reach the database lock");
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  const results = await logins;
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 401]);
  await request(cookieFrom(results.find(({ status }) => status === 200)), "GET", "/api/me", 200);
});

test("R07 invitation acceptance issues a server-side session", { timeout: 12_000 }, async () => {
  const token = randomUUID();
  await db.query(
    `INSERT INTO invitations (email, role, token, expires_at)
     VALUES ('regression-invite@example.test', 'member', $1, now() + interval '5 minutes')`,
    [token],
  );
  const path = `/api/invitations/${token}`;
  const accepted = await http(path, {
    method: "POST", json: { name: "Invited user", password: "Regression Fixture 2026!" },
  });
  assert.equal(accepted.status, 201);
  const cookie = cookieFrom(accepted);
  const me = await request(cookie, "GET", "/api/me", 200);
  assert.equal(me.email, "regression-invite@example.test");
  await request(cookie, "POST", "/api/auth/logout", 200);
  assert.equal((await http("/api/me", { cookie })).status, 404);
});

test("R07 SAML signs in once, honors session expiry, and preserves MFA", { timeout: 15_000 }, async (t) => {
  const [privateKey, publicCert] = await Promise.all(["key.pem", "cert.pem"].map((file) =>
    readFile(new URL(`./saml-fixture/${file}`, import.meta.url), "utf8"),
  ));
  const email = "regression-saml@example.test";
  const { rows: [{ id: userId }] } = await db.query(
    "INSERT INTO users (name, email) VALUES ('SAML fixture', $1) RETURNING id", [email],
  );
  await db.query(
    `UPDATE workspace_security SET saml_mode = 'required', saml_session_days = 2,
       saml_signin_url = 'https://idp.example.test/login', saml_certificate = $1 WHERE workspace_id = 1`,
    [publicCert],
  );
  t.after(() => db.query("UPDATE workspace_security SET saml_mode = 'off' WHERE workspace_id = 1"));

  const callback = "/api/auth/saml/callback";
  const assertion = (requestId) => signSamlResponse({
    privateKey, publicCert, email, requestId, callbackUrl: `${base}${callback}`, audience: "atlas-sp-1",
  });
  const submit = ({ signed, state, cookie }) => http(callback, {
    method: "POST", cookie, body: new URLSearchParams({
      SAMLResponse: signed, ...(state === null ? {} : { RelayState: state }),
    }),
  });
  async function beginSaml() {
    const start = await http("/api/auth/saml/start");
    assert.equal(start.status, 307);
    const location = new URL(start.headers.get("location"), base);
    assert.equal(location.origin, "https://idp.example.test");
    const requestXml = inflateRawSync(Buffer.from(location.searchParams.get("SAMLRequest"), "base64")).toString();
    const requestId = requestXml.match(/\bID="([^"]+)"/)?.[1];
    assert.ok(requestId);
    const state = location.searchParams.get("RelayState");
    assert.match(state ?? "", /^[A-Za-z0-9_-]{43}$/);
    const setCookie = start.headers.getSetCookie().find((item) => item.startsWith(`__Host-atlas_saml_${state}=`));
    assert.ok(setCookie);
    for (const attribute of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /SameSite=None/i, /Max-Age=600/i, /Path=\/(?:;|$)/i]) {
      assert.match(setCookie, attribute);
    }
    return { requestId, state, cookie: setCookie.split(";")[0], signed: assertion(requestId) };
  }

  const flow = await beginSaml();
  const other = await beginSaml();
  const wrongProof = `${flow.cookie.split("=")[0]}=${other.cookie.split("=")[1]}`;
  const xml = Buffer.from(flow.signed, "base64").toString("utf8");
  const tampered = xml.replace(`InResponseTo="${flow.requestId}"`, `InResponseTo="${other.requestId}"`);
  assert.notEqual(tampered, xml);
  for (const [request, reason] of [
    [{ ...flow, state: null }, "invalid_state"],
    [{ ...flow, cookie: undefined }, "invalid_state"],
    [{ ...flow, cookie: wrongProof }, "invalid_signature"],
    [{ ...other, signed: flow.signed }, "invalid_signature"],
    [{ ...other, signed: Buffer.from(tampered).toString("base64") }, "invalid_signature"],
  ]) {
    const refused = await submit(request);
    assert.equal(refused.headers.get("location"), `/login?saml_error=${reason}`);
    assert.equal(refused.headers.getSetCookie().length, 0);
  }
  const results = await Promise.all([submit(flow), submit(flow)]);
  assert.ok(results.every(({ status }) => status === 303));
  const accepted = results.find((response) => response.headers.get("location") === "/");
  const replay = results.find((response) => response.headers.get("location") === "/login?saml_error=invalid_signature");
  assert.ok(accepted && replay);
  assert.equal(replay.headers.getSetCookie().length, 0);
  assert.match(accepted.headers.getSetCookie().find((item) => item.startsWith("atlas_session=")), /Max-Age=172800/i);
  assert.match(accepted.headers.getSetCookie().find((item) => item.startsWith(`__Host-atlas_saml_${flow.state}=`)), /Max-Age=0/i);
  const full = cookieFrom(accepted);
  assert.equal((await request(full, "GET", "/api/me", 200)).email, email);

  const unsolicited = await submit({ ...other, signed: assertion(`_${randomUUID()}`) });
  assert.equal(unsolicited.headers.get("location"), "/login?saml_error=invalid_signature");
  assert.equal(unsolicited.headers.getSetCookie().length, 0);
  const another = await submit(other);
  assert.equal((await request(cookieFrom(another), "GET", "/api/me", 200)).email, email);

  const secret = "JBSWY3DPEHPK3PXP";
  await db.query("UPDATE users SET totp_enabled = true, totp_secret = $2 WHERE id = $1", [userId, secret]);
  const challenge = await submit(await beginSaml());
  assert.equal(challenge.status, 303);
  assert.equal(challenge.headers.get("location"), "/profile#two-factor");
  const pending = cookieFrom(challenge);
  assert.equal((await http("/api/me", { cookie: pending })).status, 404);
  const completed = await http("/api/me/2fa", {
    method: "POST", cookie: pending, json: { action: "verify", code: totpCode(secret) },
  });
  assert.equal(completed.status, 200);
  const rotated = cookieFrom(completed);
  assert.notEqual(rotated, pending);
  assert.equal((await request(rotated, "GET", "/api/me", 200)).email, email);
});

test("R08 a secondary editor can edit shared fields but cannot write to the primary project", { timeout: 12_000 }, async () => {
  const { a, b, owner, editor } = await fixtures("Multi-home");
  const taskId = await task(b, "Shared task");
  const { rows: [primary, secondary] } = await db.query(
    "INSERT INTO sections (project_id, name) VALUES ($1, 'Primary'), ($2, 'Secondary') RETURNING id",
    [b, a],
  );
  await db.query("UPDATE tasks SET section_id = $1 WHERE id = $2", [primary.id, taskId]);
  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [taskId, a]);

  await request(editor, "POST", `/api/tasks/${taskId}/duplicate`, 403);
  await request(editor, "POST", `/api/tasks/${taskId}/follow-up`, 403);
  await request(editor, "PATCH", `/api/tasks/${taskId}`, 403, { project_id: a });
  await request(editor, "PATCH", `/api/tasks/${taskId}`, 200, { progress: 30 });
  await request(editor, "PATCH", `/api/tasks/${taskId}`, 200, { section_id: Number(secondary.id) });
  await request(editor, "POST", "/api/memberships", 400, {
    task_id: taskId, project_id: a, section_id: Number(primary.id),
  });

  const { rows: [saved] } = await db.query(
    `SELECT t.project_id, t.section_id, t.progress, m.section_id AS secondary_section
     FROM tasks t JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $2 WHERE t.id = $1`,
    [taskId, a],
  );
  assert.deepEqual(saved, { project_id: String(b), section_id: primary.id, progress: 30, secondary_section: secondary.id });
  const { id: copy } = await request(owner, "POST", `/api/tasks/${taskId}/duplicate`, 201);
  assert.equal(await projectOf(copy), b);
});

test("R09 project editors cannot weaken field ACLs or bypass them through CSV", { timeout: 12_000 }, async () => {
  const { a, owner, editor } = await fixtures("Field ACL");
  const taskId = await task(a, "Restricted field task");
  const { rows: [field] } = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type, access_level)
     VALUES ($1, 'Restricted', 'text', 'admins') RETURNING id`,
    [a],
  );
  const value = { task_id: taskId, field_id: Number(field.id), value: "secret data" };
  await request(editor, "POST", "/api/task-values", 403, value);
  await request(editor, "PATCH", `/api/custom-fields/${field.id}`, 403, { access_level: "everyone" });
  await request(editor, "POST", "/api/task-values", 403, value);
  await request(owner, "POST", "/api/task-values", 201, value);

  const header = "セクション,種別,名前,完了,担当者,開始日,期日,進捗,Status,繰返し,コメント,Restricted";
  async function importCsv(cookie, name) {
    const body = new FormData();
    const row = ["", "タスク", name, "", "", "", "", "", "", "", "", "CSV value"].join(",");
    body.append("file", new Blob([`${header}\n${row}\n`], { type: "text/csv" }), "test.csv");
    const response = await http(`/api/projects/${a}/import`, { method: "POST", cookie, body });
    assert.equal(response.status, 201);
    return response.json();
  }
  const denied = await importCsv(editor, "Denied CSV row");
  assert.equal(denied.created, 0);
  assert.equal(denied.skipped, 1);
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = 'Denied CSV row'", [a])).rowCount, 0);
  assert.equal((await importCsv(owner, "Allowed CSV row")).created, 1);
  const { rows: [saved] } = await db.query(
    `SELECT v.value_text FROM task_custom_values v JOIN tasks t ON t.id = v.task_id
     WHERE t.project_id = $1 AND t.name = 'Allowed CSV row' AND v.field_id = $2`,
    [a, field.id],
  );
  assert.equal(saved?.value_text, "CSV value");
});

test("R10 webhook credentials are hidden and signed deliveries cannot be replayed", { timeout: 15_000 }, async () => {
  const { a, owner, editor, editorId } = await fixtures("Webhook security");
  await db.query("UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2", [a, editorId]);
  const endpoints = `/api/projects/${a}/webhook-endpoints`;
  const secret = "regression-webhook-secret";
  await request(owner, "POST", endpoints, 400, { name: "Unsigned" });
  const { endpoint } = await request(owner, "POST", endpoints, 201, { name: "Signed", secret });
  const { endpoints: visible } = await request(editor, "GET", endpoints, 200);
  assert.equal(visible[0]?.has_secret, true);
  assert.ok(!("token" in visible[0]));

  await webhookRule(a, owner, { url: "https://example.test/", secret });
  const rules = await request(editor, "GET", `/api/projects/${a}/rules`, 200);
  assert.ok(!JSON.stringify(rules).includes(secret));

  const path = `/api/automation/webhook/${endpoint.token}`;
  const body = Buffer.from('{ "text": "日本語" }\n');
  const timestamp = Math.floor(Date.now() / 1000);
  const delivery = randomUUID();
  const signed = (time, id) => ({
    "x-atlas-timestamp": String(time), "x-atlas-delivery-id": id,
    "x-atlas-signature-v2": createHmac("sha256", secret).update(`${time}.${id}.`).update(body).digest("hex"),
  });
  const send = (headers, payload = body) => http(path, { method: "POST", body: payload, headers });
  assert.equal((await send({})).status, 401);
  assert.equal((await send(signed(timestamp - 600, delivery))).status, 401);
  assert.equal((await send(signed(timestamp, delivery), Buffer.from("{}"))).status, 401);
  assert.equal((await send(signed(timestamp, delivery), Buffer.alloc(257 * 1024))).status, 413);
  const accepted = await Promise.all([send(signed(timestamp, delivery)), send(signed(timestamp, delivery))]);
  assert.deepEqual(accepted.map((response) => response.status).sort(), [202, 409]);
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM domain_events WHERE type = 'webhook.received' AND subject_id = $1 AND project_id = $2",
    [endpoint.id, a],
  );
  assert.equal(n, 1);
});
