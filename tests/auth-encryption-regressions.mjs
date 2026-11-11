import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { db, fixtures, http, request, waitForHttp } from "./regression-fixtures.mjs";
import { hashPassword } from "../lib/auth.ts";
import { decryptMfaSecret, encryptMfaSecret, isEncryptedMfaSecret, mfaSecretKeyId } from "../lib/mfa-secret.ts";
import { totpCode } from "../lib/totp.ts";
import { authRateIdentityHash } from "../lib/auth-rate-limit.ts";

before(waitForHttp);
const exec = promisify(execFile);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const password = "MFA disposable regression 2026!";
const cookieFrom = (response) => response.headers.getSetCookie().find((item) => item.startsWith("atlas_session=")).split(";")[0];

async function actor(label) {
  const f = await fixtures(label);
  const email = `mfa-encryption-${f.editorId}@example.test`;
  await db.query("UPDATE users SET email=$2,password_hash=$3 WHERE id=$1", [f.editorId, email, hashPassword(password)]);
  return { ...f, email };
}

test("MFA setup stores only ciphertext and promotes pending credentials with a new active binding", async () => {
  const f = await actor("MFA encryption enrollment");
  const begin = await http("/api/me/2fa", { cookie: f.editor, method: "POST", json: { action: "begin" } });
  assert.equal(begin.status, 200);
  assert.match(begin.headers.get("cache-control"), /no-store/);
  const { secret, otpauth_uri: uri, qr_data_url: qr } = await begin.json();
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(qr, /^data:image\/png;base64,/);
  const pending = (await db.query("SELECT totp_pending_secret,totp_secret FROM users WHERE id=$1", [f.editorId])).rows[0];
  assert.equal(pending.totp_secret, null);
  assert.ok(isEncryptedMfaSecret(pending.totp_pending_secret));
  assert.equal(pending.totp_pending_secret.includes(secret), false);
  assert.equal(decryptMfaSecret(pending.totp_pending_secret, f.editorId, "pending"), secret);
  assert.throws(() => decryptMfaSecret(pending.totp_pending_secret, f.editorId, "active"));
  const enable = await http("/api/me/2fa", { cookie: f.editor, method: "POST", json: { action: "enable", code: totpCode(secret) } });
  assert.equal(enable.status, 200);
  assert.match(enable.headers.get("cache-control"), /no-store/);
  const body = await enable.json();
  assert.equal(body.recovery_codes.length, 8);
  const active = (await db.query("SELECT totp_secret,totp_pending_secret FROM users WHERE id=$1", [f.editorId])).rows[0];
  assert.equal(active.totp_pending_secret, null);
  assert.notEqual(active.totp_secret, pending.totp_pending_secret);
  assert.equal(decryptMfaSecret(active.totp_secret, f.editorId, "active"), secret);
  await request(cookieFrom(enable), "GET", "/api/me", 200);
  const login = await http("/api/auth/login", { method: "POST", json: { email: f.email, password, totp: totpCode(secret) } });
  assert.equal(login.status, 200);
  await request(cookieFrom(login), "GET", "/api/me", 200);
});

test("MFA corrupt ciphertext, user swaps and pending-to-active swaps fail closed without issuing sessions", async () => {
  const f = await actor("MFA encryption tampering");
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptMfaSecret(secret, f.editorId, "active");
  const parts = encrypted.split(":");
  parts[4] = `${parts[4][0] === "A" ? "B" : "A"}${parts[4].slice(1)}`;
  for (const value of [parts.join(":"), encryptMfaSecret(secret, f.ownerId, "active"), encryptMfaSecret(secret, f.editorId, "pending")]) {
    await db.query("UPDATE users SET totp_enabled=true,totp_secret=$2 WHERE id=$1", [f.editorId, value]);
    const response = await http("/api/auth/login", { method: "POST", json: { email: f.email, password, totp: totpCode(secret) } });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.equal(body.includes(secret), false);
    assert.equal(body.includes(value), false);
    assert.equal(response.headers.getSetCookie().some((item) => item.startsWith("atlas_session=")), false);
  }
  await assert.rejects(db.query("UPDATE users SET totp_secret=$2 WHERE id=$1", [f.editorId, secret]), (error) => error.code === "23514");
  await assert.rejects(db.query("UPDATE users SET totp_pending_secret=$2 WHERE id=$1", [f.editorId, secret]), (error) => error.code === "23514");
});

test("MFA enrollment committed during a password login cannot be bypassed by its stale first-factor snapshot", { timeout: 20_000 }, async () => {
  const f = await actor("MFA login enrollment race");
  const { secret } = await request(f.editor, "POST", "/api/me/2fa", 200, { action: "begin" });
  const suffix = randomBytes(8).toString("hex");
  const trigger = `mfa_login_barrier_${suffix}`;
  const gateClass = 18518;
  const gateId = randomBytes(4).readUInt32BE() & 0x7fffffff;
  const identity = authRateIdentityHash("login-account", f.email);
  await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.scope='login-account' AND NEW.identity_hash='${identity}' AND NEW.attempts<OLD.attempts THEN
      PERFORM pg_advisory_xact_lock(${gateClass},${gateId});
    END IF;
    RETURN NEW;
  END; $$`);
  await db.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON auth_rate_limits
    FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  const blocker = await db.connect();
  let login;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1,$2)", [gateClass, gateId]);
    login = http("/api/auth/login", { method: "POST", json: { email: f.email, password }, timeout: 12_000 });
    void login.catch(() => undefined);
    const deadline = Date.now() + 4_000;
    while (!(await db.query(`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=$1 AND objid=$2 AND NOT granted`,
      [gateClass, gateId])).rowCount) {
      assert.ok(Date.now() < deadline, "password login must reach the post-password reservation refund barrier");
      await delay(10);
    }
    const enable = await http("/api/me/2fa", { cookie: f.editor, method: "POST", json: { action: "enable", code: totpCode(secret) } });
    assert.equal(enable.status, 200);
    assert.equal((await db.query("SELECT totp_enabled FROM users WHERE id=$1", [f.editorId])).rows[0].totp_enabled, true);
    await blocker.query("COMMIT");
    const response = await login;
    assert.equal(response.status, 401);
    assert.equal((await response.json()).two_factor_required, true);
    assert.equal(response.headers.getSetCookie().some((item) => item.startsWith("atlas_session=")), false);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    await login?.catch(() => undefined);
    await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON auth_rate_limits`);
    await db.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    blocker.release();
  }
});

async function migrationFixture(t) {
  const name = `atlas_mfa_migration_${randomBytes(8).toString("hex")}`;
  const root = await mkdtemp(join(tmpdir(), "atlas-mfa-migration-test-"));
  await mkdir(join(root, "db"), { recursive: true });
  await cp(join(appRoot, "db", "migrations"), join(root, "db", "migrations"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  await db.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  t.after(async () => { await client.end(); await db.query(`DROP DATABASE ${name} WITH (FORCE)`); });
  await client.query(await readFile(join(appRoot, "db", "init.sql"), "utf8"));
  // The concurrency fixture owns its policy row explicitly, independently of
  // whether the baseline schema happens to include development seed rows.
  await client.query("INSERT INTO workspaces(id,name) VALUES(1,'MFA migration fixture') ON CONFLICT(id) DO NOTHING");
  await client.query("INSERT INTO workspace_security(workspace_id) VALUES(1) ON CONFLICT(workspace_id) DO NOTHING");
  const run = (env = process.env) => exec(process.execPath, [join(appRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    join(appRoot, "scripts", "migrate.ts")], { cwd: root, env: { ...env, DATABASE_URL: url.href }, timeout: 15_000 });
  const rotate = (env) => exec(process.execPath, [join(appRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    join(appRoot, "scripts", "rotate-mfa-secrets.ts"), "--apply"], { cwd: appRoot, env: { ...env, DATABASE_URL: url.href }, timeout: 15_000 });
  return { client, run, rotate, databaseName: name };
}

test("MFA migration rolls back without a key, encrypts both legacy fields on retry and remains idempotent", { timeout: 30_000 }, async (t) => {
  const { client, run } = await migrationFixture(t);
  const legacy = "JBSWY3DPEHPK3PXP";
  const pending = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const { rows: [user] } = await client.query("INSERT INTO users(name,totp_enabled,totp_secret,totp_pending_secret) VALUES('Legacy MFA',true,$1,$2) RETURNING id", [legacy, pending]);
  const noKey = { ...process.env };
  delete noKey.MFA_ENCRYPTION_KEYS;
  delete noKey.MFA_ENCRYPTION_KEY_ID;
  await assert.rejects(run(noKey), /MFA encryption key configuration/);
  const read = () => client.query("SELECT totp_secret,totp_pending_secret FROM users WHERE id=$1", [user.id]);
  assert.deepEqual((await read()).rows[0], { totp_secret: legacy, totp_pending_secret: pending });
  assert.equal((await client.query("SELECT 1 FROM schema_migrations WHERE name='0018_mfa_secret_encryption.sql'")).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_totp_secret_encrypted'")).rowCount, 0);
  await run();
  const after = (await read()).rows[0];
  assert.ok(isEncryptedMfaSecret(after.totp_secret));
  assert.ok(isEncryptedMfaSecret(after.totp_pending_secret));
  assert.equal(decryptMfaSecret(after.totp_secret, user.id, "active"), legacy);
  assert.equal(decryptMfaSecret(after.totp_pending_secret, user.id, "pending"), pending);
  assert.match((await run()).stdout, /migrations complete: 0 applied/);
  assert.deepEqual((await read()).rows[0], after);
});

test("MFA empty migrations need no key and rotation retains credentials while rejecting a wrong old key atomically", { timeout: 30_000 }, async (t) => {
  const { client, run, rotate, databaseName } = await migrationFixture(t);
  const noKey = { ...process.env };
  delete noKey.MFA_ENCRYPTION_KEYS;
  delete noKey.MFA_ENCRYPTION_KEY_ID;
  await run(noKey);
  const originalKeyId = process.env.MFA_ENCRYPTION_KEY_ID;
  const user = (await client.query("INSERT INTO users(name) VALUES('Rotating MFA') RETURNING id")).rows[0];
  const original = encryptMfaSecret("JBSWY3DPEHPK3PXP", user.id, "active");
  await client.query("UPDATE users SET totp_secret=$2 WHERE id=$1", [user.id, original]);
  const newKey = randomBytes(32).toString("base64");
  const wrong = { ...process.env, MFA_ENCRYPTION_KEY_ID: "rotated",
    MFA_ENCRYPTION_KEYS: JSON.stringify({ [originalKeyId]: randomBytes(32).toString("base64"), rotated: newKey }) };
  await assert.rejects(rotate(wrong), /MFA encryption key configuration/);
  assert.equal((await client.query("SELECT totp_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_secret, original);
  const env = { ...process.env, MFA_ENCRYPTION_KEY_ID: "rotated",
    MFA_ENCRYPTION_KEYS: JSON.stringify({ ...JSON.parse(process.env.MFA_ENCRYPTION_KEYS), rotated: newKey }) };
  let rotating;
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT workspace_id FROM workspace_security WHERE workspace_id=1 FOR UPDATE");
    assert.equal(locked.rowCount, 1, "the fixture must hold its actual policy row");
    rotating = rotate(env);
    void rotating.catch(() => undefined);
    const deadline = Date.now() + 4_000;
    let waiting;
    while (!waiting) {
      // Read activity outside the lock-holding transaction: statistics fetched
      // in that transaction can retain its first pre-start activity snapshot.
      waiting = (await db.query(`SELECT pid FROM pg_stat_activity WHERE datname=$1
        AND wait_event_type='Lock' AND query LIKE 'SELECT workspace_id FROM workspace_security%'`, [databaseName])).rows[0]?.pid;
      assert.ok(waiting || Date.now() < deadline, "key rotation must wait for the policy lock before locking users");
      if (!waiting) await delay(10);
    }
    assert.equal((await client.query(`SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='users'::regclass
      AND mode='AccessExclusiveLock'`, [waiting])).rowCount, 0);
    await client.query("SELECT id FROM users WHERE id=$1", [user.id]);
    await client.query("COMMIT");
    await rotating;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await rotating?.catch(() => undefined);
  }
  const rotated = (await client.query("SELECT totp_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_secret;
  assert.equal(mfaSecretKeyId(rotated), "rotated");
  assert.equal(decryptMfaSecret(rotated, user.id, "active", { ...env, MFA_ENCRYPTION_KEYS: JSON.stringify({ rotated: newKey }) }), "JBSWY3DPEHPK3PXP");
  await rotate({ ...env, MFA_ENCRYPTION_KEYS: JSON.stringify({ rotated: newKey }) });
  assert.equal((await client.query("SELECT totp_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_secret, rotated);
});
