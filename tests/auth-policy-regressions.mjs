import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";
import { WebSocket } from "ws";
import { encryptMfaSecret } from "../lib/mfa-secret.ts";
import { totpCode } from "../lib/totp.ts";
import { signSamlResponse } from "./saml-assertion.mjs";
import { base, db, fixtures, http, request, session, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function resetPolicy(t) {
  await db.query("UPDATE workspace_security SET saml_mode='optional',two_factor_policy='optional' WHERE workspace_id=1");
  t.after(() => db.query("UPDATE workspace_security SET saml_mode='off',two_factor_policy='optional' WHERE workspace_id=1"));
}

async function user(isGuest = false, isAdmin = false) {
  const result = await db.query("INSERT INTO users(name,is_guest,is_admin) VALUES('SAML policy fixture',$1,$2) RETURNING id", [isGuest, isAdmin]);
  return Number(result.rows[0].id);
}

async function credential(id, authMethod = "password", mfaPending = false, q = db) {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const result = await q.query(`INSERT INTO user_sessions(token_hash,user_id,expires_at,auth_method,mfa_enrollment_only)
    VALUES($1,$2,now()+interval '10 minutes',$3,$4) RETURNING token_hash`, [hash, id, authMethod, mfaPending]);
  return { raw, hash, cookie: `atlas_session=${raw}`, created: result.rowCount };
}

async function setPolicy(admin, mode, fields = {}) {
  return request(admin, "PATCH", "/api/admin/security", 200, {
    saml_mode: mode, saml_signin_url: "https://idp.example.test/login", saml_certificate: "policy fixture certificate", ...fields,
  });
}

async function exists(hash) {
  return (await db.query("SELECT 1 FROM user_sessions WHERE token_hash=$1", [hash])).rowCount === 1;
}

function cookieFrom(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("atlas_session="))?.split(";")[0];
  assert.match(cookie ?? "", /^atlas_session=[A-Za-z0-9_-]{43}$/);
  return cookie;
}

async function waitForLock(pid) {
  const deadline = Date.now() + 3000;
  while (!(await db.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [pid])).rowCount) {
    assert.ok(Date.now() < deadline, "the competing session/policy writer must be waiting on its lock");
    await delay(10);
  }
}

function connect(projectId, cookie) {
  const url = new URL(`/api/ws?project=${projectId}`, base);
  url.protocol = "ws:";
  const socket = new WebSocket(url, { origin: base, headers: { Cookie: cookie }, handshakeTimeout: 4000 });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ status: 101, socket }));
    socket.once("unexpected-response", (_req, res) => { res.resume(); resolve({ status: res.statusCode, socket }); socket.terminate(); });
    socket.on("error", reject);
  });
}

test("SAML mandatory policy atomically revokes password and enrollment sessions while preserving SAML and emergency admins", async (t) => {
  await resetPolicy(t);
  const admin = await session(await user(false, true));
  const member = await user();
  const guest = await user(true);
  const password = await credential(member);
  const guestPassword = await credential(guest);
  const enrollment = await credential(member, "password", true);
  const saml = await credential(member, "saml");
  const samlEnrollment = await credential(member, "saml", true);
  await request(password.cookie, "GET", "/api/me", 200);
  await setPolicy(admin, "required");
  for (const old of [password, guestPassword, enrollment]) {
    assert.equal(await exists(old.hash), false);
    assert.equal((await http("/api/me", { cookie: old.cookie })).status, 404);
  }
  assert.equal(await exists(saml.hash), true);
  assert.equal(await exists(samlEnrollment.hash), true);
  await request(saml.cookie, "GET", "/api/me", 200);
  await request(admin, "GET", "/api/me", 200);
  assert.equal((await http("/api/me", { cookie: samlEnrollment.cookie })).status, 404, "SAML provenance must not bypass unfinished MFA");
  await setPolicy(admin, "optional");
  assert.equal((await http("/api/me", { cookie: password.cookie })).status, 404, "relaxing policy must not resurrect a deleted credential");
});

test("SAML members-only preserves guests and administrators but classification changes cannot revive old password credentials", async (t) => {
  await resetPolicy(t);
  const admin = await session(await user(false, true));
  const member = await user();
  const guest = await user(true);
  const memberPassword = await credential(member);
  const guestPassword = await credential(guest);
  const guestSaml = await credential(guest, "saml");
  await setPolicy(admin, "members_only");
  assert.equal(await exists(memberPassword.hash), false);
  await request(guestPassword.cookie, "GET", "/api/me", 200);
  await request(admin, "GET", "/api/me", 200);
  await db.query("UPDATE users SET is_guest=false WHERE id=$1", [guest]);
  assert.equal(await exists(guestPassword.hash), false);
  assert.equal((await http("/api/me", { cookie: guestPassword.cookie })).status, 404);
  await request(guestSaml.cookie, "GET", "/api/me", 200);
  await db.query("UPDATE users SET is_guest=true WHERE id=$1", [guest]);
  assert.equal((await http("/api/me", { cookie: guestPassword.cookie })).status, 404);
  const remainingGuestPassword = await credential(guest);
  await setPolicy(admin, "required");
  assert.equal(await exists(remainingGuestPassword.hash), false, "strengthening members-only to all also revokes guest sessions");
});

test("SAML session policy is checked on every HTTP and WebSocket authorization even for legacy rows bypassing the write guard", async (t) => {
  await resetPolicy(t);
  const f = await fixtures("SAML legacy read guard");
  const admin = await session(await user(false, true));
  await setPolicy(admin, "required");
  const saml = await credential(f.editorId, "saml");
  const q = await db.connect();
  let legacy;
  try {
    await q.query("BEGIN");
    await q.query("SET LOCAL session_replication_role=replica");
    legacy = await credential(f.editorId, "password", false, q);
    await q.query("COMMIT");
  } finally { await q.query("ROLLBACK").catch(() => {}); q.release(); }
  assert.equal(await exists(legacy.hash), true);
  for (let count = 0; count < 2; count++) assert.equal((await http("/api/me", { cookie: legacy.cookie })).status, 404);
  assert.equal((await connect(f.a, legacy.cookie)).status, 401);
  await request(saml.cookie, "GET", "/api/me", 200);
  const active = await connect(f.a, saml.cookie);
  assert.equal(active.status, 101);
  active.socket.terminate();
});

test("SAML mandatory policy closes an already connected password WebSocket and keeps a SAML socket usable", { timeout: 12000 }, async (t) => {
  await resetPolicy(t);
  const f = await fixtures("SAML live revocation");
  const admin = await session(await user(false, true));
  const saml = await credential(f.editorId, "saml");
  const old = await connect(f.a, f.editor);
  const retained = await connect(f.a, saml.cookie);
  assert.equal(old.status, 101); assert.equal(retained.status, 101);
  t.after(() => { old.socket.terminate(); retained.socket.terminate(); });
  const closed = once(old.socket, "close");
  await setPolicy(admin, "required");
  const [code] = await Promise.race([closed, delay(7000).then(() => assert.fail("revoked socket was not closed"))]);
  assert.equal(code, 1008);
  assert.equal(retained.socket.readyState, WebSocket.OPEN);
  await request(saml.cookie, "GET", "/api/me", 200);
});

test("SAML provenance survives MFA enrollment and verification rotations with the original expiry", async (t) => {
  await resetPolicy(t);
  const admin = await session(await user(false, true));
  const id = await user();
  const pending = await credential(id, "saml", true);
  const expires = (await db.query("SELECT expires_at::text AS expires FROM user_sessions WHERE token_hash=$1", [pending.hash])).rows[0].expires;
  await setPolicy(admin, "required");
  const { secret } = await request(pending.cookie, "POST", "/api/me/2fa", 200, { action: "begin" });
  const enabled = await http("/api/me/2fa", { cookie: pending.cookie, method: "POST", json: { action: "enable", code: totpCode(secret) } });
  assert.equal(enabled.status, 200);
  const enrolled = cookieFrom(enabled);
  const enrollmentRow = (await db.query("SELECT auth_method,expires_at::text AS expires FROM user_sessions WHERE token_hash=$1", [createHash("sha256").update(enrolled.split("=")[1]).digest("hex")])).rows[0];
  assert.equal(enrollmentRow.auth_method, "saml"); assert.equal(enrollmentRow.expires, expires);
  assert.equal(await exists(pending.hash), false);
  await request(enrolled, "GET", "/api/me", 200);
  const verifyPending = await credential(id, "saml", true);
  const verified = await http("/api/me/2fa", { cookie: verifyPending.cookie, method: "POST", json: { action: "verify", code: totpCode(secret) } });
  assert.equal(verified.status, 200);
  const full = cookieFrom(verified);
  const row = (await db.query("SELECT auth_method FROM user_sessions WHERE token_hash=$1", [createHash("sha256").update(full.split("=")[1]).digest("hex")])).rows[0];
  assert.equal(row.auth_method, "saml");
  await request(full, "GET", "/api/me", 200);
});

test("SAML policy rejects a password insert queued behind a mandatory-policy commit", { timeout: 12000 }, async (t) => {
  await resetPolicy(t);
  const id = await user();
  const changer = await db.connect();
  const creator = await db.connect();
  const pid = Number((await creator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let running;
  try {
    await changer.query("BEGIN");
    await changer.query("SET LOCAL statement_timeout='5s'");
    await changer.query("UPDATE workspace_security SET saml_mode='required' WHERE workspace_id=1");
    await creator.query("BEGIN");
    await creator.query("SET LOCAL statement_timeout='5s'");
    running = credential(id, "password", false, creator);
    await waitForLock(pid);
    await changer.query("COMMIT");
    const inserted = await running;
    await creator.query("COMMIT");
    assert.equal(inserted.created, 0);
    assert.equal(await exists(inserted.hash), false);
  } finally {
    await changer.query("ROLLBACK").catch(() => {});
    await running?.catch(() => {});
    await creator.query("ROLLBACK").catch(() => {});
    changer.release(); creator.release();
  }
});

test("SAML policy waits for a shared-policy session creator then revokes its just-committed password credential", { timeout: 12000 }, async (t) => {
  await resetPolicy(t);
  const id = await user();
  const creator = await db.connect();
  const changer = await db.connect();
  const pid = Number((await changer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let running;
  try {
    await creator.query("BEGIN");
    await creator.query("SET LOCAL statement_timeout='5s'");
    const inserted = await credential(id, "password", false, creator);
    assert.equal(inserted.created, 1);
    await changer.query("BEGIN");
    await changer.query("SET LOCAL statement_timeout='5s'");
    running = changer.query("UPDATE workspace_security SET saml_mode='required' WHERE workspace_id=1");
    await waitForLock(pid);
    await creator.query("COMMIT");
    await running;
    await changer.query("COMMIT");
    assert.equal(await exists(inserted.hash), false);
  } finally {
    await creator.query("ROLLBACK").catch(() => {});
    await running?.catch(() => {});
    await changer.query("ROLLBACK").catch(() => {});
    creator.release(); changer.release();
  }
});

test("SAML invalid settings and audit persistence failure never partially revoke sessions", async (t) => {
  await resetPolicy(t);
  const adminId = await user(false, true);
  const admin = await session(adminId);
  const password = await credential(await user());
  await request(admin, "PATCH", "/api/admin/security", 400, { saml_mode: "required", saml_certificate: "" });
  assert.equal(await exists(password.hash), true);
  await db.query(`CREATE FUNCTION auth_policy_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'auth policy regression audit failure'; END $$`);
  await db.query(`CREATE TRIGGER auth_policy_reject_audit BEFORE INSERT ON audit_log
    FOR EACH ROW WHEN(NEW.action='security.update' AND NEW.actor_id=${adminId}) EXECUTE FUNCTION auth_policy_reject_audit()`);
  try {
    await request(admin, "PATCH", "/api/admin/security", 500, {
      saml_mode: "required", saml_signin_url: "https://idp.example.test/login", saml_certificate: "fixture",
    });
    assert.equal((await db.query("SELECT saml_mode FROM workspace_security WHERE workspace_id=1")).rows[0].saml_mode, "optional");
    assert.equal(await exists(password.hash), true);
    await request(password.cookie, "GET", "/api/me", 200);
  } finally {
    await db.query("DROP TRIGGER auth_policy_reject_audit ON audit_log");
    await db.query("DROP FUNCTION auth_policy_reject_audit()");
  }
});

test("SAML policy and guest classification changes serialize without leaving a usable password credential", { timeout: 15000 }, async (t) => {
  await resetPolicy(t);
  const id = await user(true);
  const old = await credential(id);
  const classifier = await db.connect();
  const changer = await db.connect();
  const changerPid = Number((await changer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let running;
  try {
    await classifier.query("BEGIN");
    await classifier.query("SET LOCAL statement_timeout='5s'");
    await classifier.query("UPDATE users SET is_guest=false WHERE id=$1", [id]);
    await changer.query("BEGIN");
    await changer.query("SET LOCAL statement_timeout='5s'");
    running = changer.query("UPDATE workspace_security SET saml_mode='members_only' WHERE workspace_id=1");
    await waitForLock(changerPid);
    await classifier.query("COMMIT");
    await running;
    await changer.query("COMMIT");
    assert.equal(await exists(old.hash), false);
    assert.equal((await http("/api/me", { cookie: old.cookie })).status, 404);
  } finally {
    await classifier.query("ROLLBACK").catch(() => {});
    await running?.catch(() => {});
    await changer.query("ROLLBACK").catch(() => {});
    classifier.release(); changer.release();
  }
});

for (const classificationFirst of [true, false]) {
  test(`SAML session insert and admin demotion serialize with ${classificationFirst ? "classification" : "session creation"} first`, { timeout: 15000 }, async (t) => {
    await resetPolicy(t);
    const id = await user(false, true);
    await db.query("UPDATE workspace_security SET saml_mode='required' WHERE workspace_id=1");
    const classifier = await db.connect();
    const creator = await db.connect();
    const creatorPid = Number((await creator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const classifierPid = Number((await classifier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    let running;
    let inserted;
    try {
      await classifier.query("BEGIN"); await creator.query("BEGIN");
      await classifier.query("SET LOCAL statement_timeout='5s'"); await creator.query("SET LOCAL statement_timeout='5s'");
      if (classificationFirst) {
        await classifier.query("UPDATE users SET is_admin=false WHERE id=$1", [id]);
        running = credential(id, "password", false, creator);
        await waitForLock(creatorPid);
        await classifier.query("COMMIT");
        inserted = await running;
        assert.equal(inserted.created, 0, "the insertion must read the new classification after the user lock is released");
        await creator.query("COMMIT");
      } else {
        inserted = await credential(id, "password", false, creator);
        assert.equal(inserted.created, 1);
        running = classifier.query("UPDATE users SET is_admin=false WHERE id=$1", [id]);
        await waitForLock(classifierPid);
        await creator.query("COMMIT");
        await running;
        await classifier.query("COMMIT");
      }
      assert.equal(await exists(inserted.hash), false);
      await db.query("UPDATE workspace_security SET saml_mode='off' WHERE workspace_id=1");
      assert.equal((await http("/api/me", { cookie: inserted.cookie })).status, 404, "the rejected/revoked credential must not revive when policy relaxes");
    } finally {
      await (classificationFirst ? classifier : creator).query("ROLLBACK").catch(() => {});
      await running?.catch(() => {});
      await (classificationFirst ? creator : classifier).query("ROLLBACK").catch(() => {});
      classifier.release(); creator.release();
    }
  });
}

test("SAML final session issuance rechecks MFA enrolled during assertion processing", { timeout: 15000 }, async (t) => {
  await resetPolicy(t);
  const [privateKey, publicCert] = await Promise.all(["key.pem", "cert.pem"].map((file) => readFile(new URL(`./saml-fixture/${file}`, import.meta.url), "utf8")));
  const id = await user();
  const email = `saml-policy-race-${id}@example.test`;
  await db.query("UPDATE users SET email=$2 WHERE id=$1", [id, email]);
  await db.query("UPDATE workspace_security SET saml_signin_url='https://idp.example.test/login',saml_certificate=$1,saml_jit_provisioning=false WHERE workspace_id=1", [publicCert]);
  const start = await http("/api/auth/saml/start");
  assert.equal(start.status, 307);
  const location = new URL(start.headers.get("location"));
  const requestXml = inflateRawSync(Buffer.from(location.searchParams.get("SAMLRequest"), "base64")).toString();
  const requestId = requestXml.match(/\bID="([^"]+)"/)?.[1];
  const state = location.searchParams.get("RelayState");
  assert.ok(requestId); assert.ok(state);
  const flowCookie = start.headers.getSetCookie().find((item) => item.startsWith(`__Host-atlas_saml_${state}=`))?.split(";")[0];
  assert.ok(flowCookie);
  const signed = signSamlResponse({ privateKey, publicCert, email, requestId, callbackUrl: `${base}/api/auth/saml/callback`, audience: "atlas-sp-1" });
  const blocker = await db.connect();
  const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let callback;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SET LOCAL statement_timeout='5s'");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
    callback = http("/api/auth/saml/callback", { method: "POST", cookie: flowCookie, timeout: 10000,
      body: new URLSearchParams({ SAMLResponse: signed, RelayState: state }) });
    const deadline = Date.now() + 3000;
    while (!(await db.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'", [blockerPid])).rowCount) {
      assert.ok(Date.now() < deadline, "callback must wait at final user/session issuance after its initial user read");
      await delay(10);
    }
    const secret = "JBSWY3DPEHPK3PXP";
    await blocker.query("UPDATE users SET totp_enabled=true,totp_secret=$2,totp_enrolled_at=clock_timestamp() WHERE id=$1", [id, encryptMfaSecret(secret, id, "active")]);
    await blocker.query("COMMIT");
    const response = await callback;
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/profile#two-factor");
    const pending = cookieFrom(response);
    assert.equal((await http("/api/me", { cookie: pending })).status, 404);
    const verified = await http("/api/me/2fa", { cookie: pending, method: "POST", json: { action: "verify", code: totpCode(secret) } });
    assert.equal(verified.status, 200);
    await request(cookieFrom(verified), "GET", "/api/me", 200);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    await callback?.catch(() => {});
    blocker.release();
  }
});

test("SAML authentication provenance and session identity cannot be rewritten while expiry maintenance remains possible", async (t) => {
  await resetPolicy(t);
  const first = await user();
  const second = await user();
  const password = await credential(first);
  await assert.rejects(db.query("UPDATE user_sessions SET auth_method='saml' WHERE token_hash=$1", [password.hash]), /provenance is immutable/);
  await assert.rejects(db.query("UPDATE user_sessions SET user_id=$2 WHERE token_hash=$1", [password.hash, second]), /provenance is immutable/);
  const updated = await db.query("UPDATE user_sessions SET expires_at=now()+interval '2 minutes' WHERE token_hash=$1 RETURNING auth_method,user_id", [password.hash]);
  assert.equal(updated.rowCount, 1);
  assert.equal(updated.rows[0].auth_method, "password");
  assert.equal(Number(updated.rows[0].user_id), first);
  await request(password.cookie, "GET", "/api/me", 200);
});

test("SAML migration classifies legacy credentials conservatively and is repeatable without losing admin access", async () => {
  const sql = await readFile(new URL("../db/migrations/0019_saml_session_policy.sql", import.meta.url), "utf8");
  const q = await db.connect();
  const schema = `auth_policy_${randomBytes(6).toString("hex")}`;
  try {
    await q.query("BEGIN");
    await q.query(`CREATE SCHEMA ${schema}`);
    await q.query(`SET LOCAL search_path=${schema},pg_catalog`);
    await q.query(`CREATE TABLE workspaces(id bigint primary key);
      INSERT INTO workspaces VALUES(1);
      CREATE TABLE workspace_security(workspace_id bigint primary key,saml_mode text);
      INSERT INTO workspace_security VALUES(1,'required');
      CREATE TABLE users(id bigint primary key,is_admin boolean,is_guest boolean);
      INSERT INTO users VALUES(1,true,false),(2,false,false),(3,false,true);
      CREATE TABLE user_sessions(token_hash text primary key,user_id bigint);
      INSERT INTO user_sessions VALUES('admin',1),('member',2),('guest',3)`);
    await q.query(sql);
    assert.deepEqual((await q.query("SELECT token_hash,auth_method FROM user_sessions ORDER BY token_hash")).rows,
      [{ token_hash: "admin", auth_method: "password" }]);
    await q.query(sql);
    assert.equal((await q.query("SELECT token_hash FROM user_sessions")).rowCount, 1);
  } finally { await q.query("ROLLBACK").catch(() => {}); q.release(); }
});
