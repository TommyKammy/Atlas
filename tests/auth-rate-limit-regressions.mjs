import assert from "node:assert/strict";
import { before, beforeEach, afterEach, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, http, request, session, waitForHttp } from "./regression-fixtures.mjs";
import { hashPassword } from "../lib/auth.ts";
import { totpCode, verifyTotp } from "../lib/totp.ts";
import {
  AUTH_RATE_CLEANUP_BATCH, AuthRateLimitError, POLICIES, authRateIdentityHash,
  cleanupAuthRateLimits, guardAuthRequest, reserveAuthAttempt,
} from "../lib/auth-rate-limit.ts";

before(waitForHttp);
// This file only runs through regression-fixtures' exact disposable DATABASE_URL
// guard. Cases run serially; isolate shared network/global quotas from each other.
beforeEach(() => db.query("DELETE FROM auth_rate_limits"));
afterEach(() => db.query("DELETE FROM auth_rate_limits"));

const password = "Rate-Limit-Fixture-2026!";
function cookieFrom(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("atlas_session="));
  assert.ok(cookie, "successful authentication must set its session cookie");
  return cookie.split(";")[0];
}
async function actor(label) {
  const email = `rate-${randomUUID()}@example.test`;
  const { rows: [user] } = await db.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id",
    [label, email, hashPassword(password)]);
  return { id: Number(user.id), email, cookie: await session(user.id) };
}
function login(user, overrides = {}, headers = {}) {
  return http("/api/auth/login", { method: "POST", headers, json: { email: user.email, password, ...overrides } });
}
function badCode(secret) {
  for (let n = 0; n < 100; n++) {
    const code = String(n).padStart(6, "0");
    if (!verifyTotp(secret, code)) return code;
  }
  assert.fail("could not choose an invalid TOTP fixture");
}
async function enroll(user) {
  const pending = await request(user.cookie, "POST", "/api/me/2fa", 200, { action: "begin" });
  const response = await http("/api/me/2fa", { method: "POST", cookie: user.cookie,
    json: { action: "enable", code: totpCode(pending.secret) } });
  assert.equal(response.status, 200);
  const body = await response.json();
  return { secret: pending.secret, recoveryCodes: body.recovery_codes, cookie: cookieFrom(response) };
}
async function blocked(response) {
  assert.equal(response.status, 429);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.error, "too_many_attempts");
  const seconds = Number(response.headers.get("retry-after"));
  assert.ok(Number.isSafeInteger(seconds) && seconds >= 1);
  assert.equal(body.retry_after_seconds, seconds);
}
async function windowFor(scope, identity) {
  return (await db.query("SELECT * FROM auth_rate_limits WHERE scope=$1 AND identity_hash=$2",
    [scope, authRateIdentityHash(scope, identity)])).rows[0];
}
async function expire(scope, identity) {
  await db.query(`UPDATE auth_rate_limits SET window_started_at=clock_timestamp()-interval '2 days',
    expires_at=clock_timestamp()-interval '1 day' WHERE scope=$1 AND identity_hash=$2`,
  [scope, authRateIdentityHash(scope, identity)]);
}

test("authentication admission is atomic across concurrent database connections and returns only one reservation", async () => {
  const scope = `test-${randomUUID()}`;
  const policy = { limit: 5, windowSeconds: 60 };
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, () => reserveAuthAttempt(scope, "parallel", policy, db)));
  const accepted = attempts.filter((result) => result.status === "fulfilled");
  const refused = attempts.filter((result) => result.status === "rejected");
  assert.equal(accepted.length, policy.limit);
  assert.equal(refused.length, 25);
  assert.ok(refused.every((result) => result.reason instanceof AuthRateLimitError));
  assert.equal((await windowFor(scope, "parallel")).attempts, 5);
  await Promise.all([accepted[0].value.release(), accepted[0].value.release()]);
  assert.equal((await windowFor(scope, "parallel")).attempts, 4);
  await reserveAuthAttempt(scope, "parallel", policy, db);
  assert.equal((await windowFor(scope, "parallel")).attempts, 5);
});

test("expired windows recover and stale successful requests cannot refund a newer window", async () => {
  const scope = `test-${randomUUID()}`;
  const policy = { limit: 1, windowSeconds: 60 };
  const old = await reserveAuthAttempt(scope, "expiry", policy, db);
  await expire(scope, "expiry");
  const current = await reserveAuthAttempt(scope, "expiry", policy, db);
  await old.release();
  assert.equal((await windowFor(scope, "expiry")).attempts, 1);
  await assert.rejects(reserveAuthAttempt(scope, "expiry", policy, db), AuthRateLimitError);
  await current.release();
  assert.equal((await windowFor(scope, "expiry")).attempts, 0);
});

test("successful credential changes and refunds can roll back together", async () => {
  const user = await actor("transaction refund");
  const scope = `test-${randomUUID()}`;
  const reservation = await reserveAuthAttempt(scope, String(user.id), { limit: 2, windowSeconds: 60 }, db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET name='should roll back' WHERE id=$1", [user.id]);
    await reservation.release(client);
    await client.query("ROLLBACK");
  } finally { client.release(); }
  assert.equal((await windowFor(scope, String(user.id))).attempts, 1);
  assert.equal((await db.query("SELECT name FROM users WHERE id=$1", [user.id])).rows[0].name, "transaction refund");
});

test("expired rate data cleanup is bounded and preserves active buckets", async () => {
  const scope = `test-${randomUUID()}`;
  await db.query(`INSERT INTO auth_rate_limits(scope,identity_hash,attempts,window_started_at,expires_at)
    SELECT $1,lpad(to_hex(n),64,'0'),1,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'
    FROM generate_series(1,$2) n`, [scope, AUTH_RATE_CLEANUP_BATCH + 3]);
  const live = await reserveAuthAttempt("test-active", "live", { limit: 2, windowSeconds: 60 }, db);
  // reserve itself removed one bounded batch, leaving precisely three stale rows.
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM auth_rate_limits WHERE scope=$1", [scope])).rows[0].n), 3);
  await cleanupAuthRateLimits(db);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM auth_rate_limits WHERE scope=$1", [scope])).rows[0].n), 0);
  assert.equal((await windowFor("test-active", "live")).attempts, 1);
  await live.release();
});

test("the aggregate guard is shared by all endpoints and ignores untrusted forwarding headers", async () => {
  for (const endpoint of ["login", "saml-start", "saml-callback", "invitation"]) {
    await guardAuthRequest(new Request("http://atlas.test", { headers: {
      "x-forwarded-for": randomUUID(), "x-real-ip": "203.0.113.1", "x-atlas-auth-client-ip": "192.0.2.1",
    } }), endpoint, db);
  }
  const rows = (await db.query("SELECT scope,attempts FROM auth_rate_limits")).rows;
  assert.deepEqual(rows, [{ scope: "global", attempts: 4 }]);
});

test("failed login identities normalize consistently and forwarding headers cannot bypass their quota", async () => {
  const user = await actor("normalized login");
  const limit = POLICIES["login-account"].limit;
  for (let n = 0; n < limit; n++) {
    const response = await login(user, { email: n % 2 ? `  ${user.email.toUpperCase()}  ` : user.email, password: "wrong" },
      { "x-forwarded-for": `192.0.2.${n + 1}`, "x-real-ip": `198.51.100.${n + 1}` });
    assert.equal(response.status, 401);
  }
  const sessions = Number((await db.query("SELECT count(*) AS n FROM user_sessions WHERE user_id=$1", [user.id])).rows[0].n);
  await blocked(await login(user));
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM user_sessions WHERE user_id=$1", [user.id])).rows[0].n), sessions);
  const other = await actor("independent login");
  assert.equal((await login(other)).status, 200);
  assert.equal((await windowFor("login-account", user.email)).attempts, limit);
  const serialized = JSON.stringify((await db.query("SELECT * FROM auth_rate_limits")).rows);
  assert.equal(serialized.includes(user.email), false);
  assert.equal(serialized.includes("192.0.2."), false);
  await expire("login-account", user.email);
  assert.equal((await login(user)).status, 200);
});

test("successful logins refund their own quota without erasing previous failures", async () => {
  const user = await actor("success quota");
  assert.equal((await login(user, { password: "wrong" })).status, 401);
  for (let n = 0; n < POLICIES["login-account"].limit + 2; n++) assert.equal((await login(user)).status, 200);
  assert.equal((await windowFor("login-account", user.email)).attempts, 1);
});

test("database limiter failure returns 503 and never creates an authentication session", async () => {
  const user = await actor("database failure");
  const suffix = randomUUID().replaceAll("-", "");
  const fn = `reject_rate_${suffix}`;
  const trigger = `reject_rate_trigger_${suffix}`;
  await db.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled auth quota failure'; END $$`);
  await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON auth_rate_limits FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  const before = Number((await db.query("SELECT count(*) AS n FROM user_sessions WHERE user_id=$1", [user.id])).rows[0].n);
  try {
    const response = await login(user);
    assert.equal(response.status, 503);
    assert.equal(response.headers.has("set-cookie"), false);
    assert.deepEqual(await response.json(), { error: "auth_temporarily_unavailable" });
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM user_sessions WHERE user_id=$1", [user.id])).rows[0].n), before);
    await request(user.cookie, "GET", "/api/me", 200);
  } finally {
    await db.query(`DROP TRIGGER ${trigger} ON auth_rate_limits`);
    await db.query(`DROP FUNCTION ${fn}()`);
  }
  assert.equal((await login(user)).status, 200);
});

test("MFA enrollment initiation is limited without replacing its pending secret on rejection", async () => {
  const user = await actor("enrollment quota");
  for (let n = 0; n < POLICIES["mfa-enroll"].limit; n++) await request(user.cookie, "POST", "/api/me/2fa", 200, { action: "begin" });
  const before = (await db.query("SELECT totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_pending_secret;
  await blocked(await http("/api/me/2fa", { method: "POST", cookie: user.cookie, json: { action: "begin" } }));
  assert.equal((await db.query("SELECT totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_pending_secret === before, true);
});

test("MFA enabling and disabling share one verification budget and 429 preserves all secrets", async () => {
  const user = await actor("MFA management quota");
  const { secret } = await request(user.cookie, "POST", "/api/me/2fa", 200, { action: "begin" });
  const code = badCode(secret);
  const before = (await db.query("SELECT totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_pending_secret;
  for (let n = 0; n < POLICIES["mfa-manage"].limit; n++) {
    const data = n % 2 ? { action: "disable", password: "wrong" } : { action: "enable", code };
    const response = await http("/api/me/2fa", { method: "POST", cookie: user.cookie, json: data });
    assert.equal(response.status, n % 2 ? 401 : 400);
  }
  await blocked(await http("/api/me/2fa", { method: "POST", cookie: user.cookie, json: { action: "enable", code: totpCode(secret) } }));
  const me = (await db.query("SELECT totp_enabled,totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0];
  assert.equal(me.totp_enabled, false);
  assert.equal(me.totp_pending_secret === before, true);
});

test("login TOTP and MFA recovery verification share a quota and blocked codes are not consumed", async () => {
  const user = await actor("shared MFA quota");
  const mfa = await enroll(user);
  const token = mfa.cookie.split("=")[1];
  await db.query("UPDATE user_sessions SET mfa_enrollment_only=true WHERE token_hash=$1", [createHash("sha256").update(token).digest("hex")]);
  const code = badCode(mfa.secret);
  for (let n = 0; n < POLICIES["mfa-verify"].limit; n++) {
    const response = n % 2 ? await http("/api/me/2fa", { method: "POST", cookie: mfa.cookie,
      json: { action: "verify", recovery_code: "INVALID-RATE-CODE" } }) : await login(user, { totp: code });
    assert.equal(response.status, 401);
  }
  const before = (await db.query("SELECT totp_recovery_codes FROM users WHERE id=$1", [user.id])).rows[0].totp_recovery_codes;
  await blocked(await login(user, { recovery_code: mfa.recoveryCodes[0] }));
  await blocked(await http("/api/me/2fa", { method: "POST", cookie: mfa.cookie,
    json: { action: "verify", code: totpCode(mfa.secret) } }));
  assert.deepEqual((await db.query("SELECT totp_recovery_codes FROM users WHERE id=$1", [user.id])).rows[0].totp_recovery_codes, before);
  await expire("mfa-verify", String(user.id));
  assert.equal((await login(user, { recovery_code: mfa.recoveryCodes[0] })).status, 200);
});

test("password-change throttling preserves the old password and ordinary profile editing remains available", async () => {
  const user = await actor("password quota");
  const before = (await db.query("SELECT password_hash FROM users WHERE id=$1", [user.id])).rows[0].password_hash;
  for (let n = 0; n < POLICIES["password-change"].limit; n++) await request(user.cookie, "PATCH", "/api/me", 401,
    { current_password: "wrong", new_password: "New-Rate-Fixture-2026!" });
  await blocked(await http("/api/me", { method: "PATCH", cookie: user.cookie,
    json: { current_password: password, new_password: "New-Rate-Fixture-2026!" } }));
  assert.equal((await db.query("SELECT password_hash FROM users WHERE id=$1", [user.id])).rows[0].password_hash === before, true);
  await request(user.cookie, "PATCH", "/api/me", 200, { name: "Profile remains editable" });
});

test("invitation throttling prevents account creation and accepting a token after its allowance is exhausted", async () => {
  const token = randomUUID();
  const email = `rate-invite-${randomUUID()}@example.test`;
  await db.query(`INSERT INTO invitations(email,role,token,expires_at) VALUES($1,'member',$2,clock_timestamp()+interval '1 hour')`, [email, token]);
  for (let n = 0; n < POLICIES.invitation.limit; n++) {
    const response = await http(`/api/invitations/${token}`, { method: "POST", json: { name: "", password } });
    assert.equal(response.status, 400);
  }
  await blocked(await http(`/api/invitations/${token}`, { method: "POST", json: { name: "Should remain uncreated", password } }));
  assert.equal((await db.query("SELECT accepted_at FROM invitations WHERE token=$1", [token])).rows[0].accepted_at, null);
  assert.equal((await db.query("SELECT id FROM users WHERE email=$1", [email])).rowCount, 0);
  await expire("invitation", token);
  assert.equal((await http(`/api/invitations/${token}`, { method: "POST", json: { name: "Invited after expiry", password } })).status, 201);
});

test("SAML admission rejects over-budget start and callback before cache or authentication mutations", async () => {
  const previous = (await db.query("SELECT saml_mode,saml_signin_url,saml_certificate FROM workspace_security WHERE workspace_id=1")).rows[0];
  const cert = await readFile(new URL("./saml-fixture/cert.pem", import.meta.url), "utf8");
  try {
    await db.query("UPDATE workspace_security SET saml_mode='optional',saml_signin_url='https://idp.example.test/login',saml_certificate=$1 WHERE workspace_id=1", [cert]);
    const start = await http("/api/auth/saml/start");
    assert.equal(start.status, 307);
    assert.equal(new URL(start.headers.get("location")).origin, "https://idp.example.test");
    assert.equal((await db.query("SELECT * FROM auth_rate_limits WHERE scope='saml-start'")).rowCount, 1);
    await db.query("UPDATE auth_rate_limits SET attempts=$1 WHERE scope='saml-start'", [POLICIES["saml-start"].limit]);
    const before = (await db.query(`SELECT (SELECT count(*)::int FROM saml_cache) AS cache,
      (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM user_sessions) AS sessions`)).rows[0];
    await blocked(await http("/api/auth/saml/start", { headers: { "x-forwarded-for": "203.0.113.77", "x-atlas-auth-client-ip": "192.0.2.42", "x-atlas-auth-client-proof": "a".repeat(64) } }));
    const malformed = await http("/api/auth/saml/callback", { method: "POST", body: new URLSearchParams({ SAMLResponse: "invalid" }) });
    assert.equal(malformed.status, 303);
    assert.equal((await db.query("SELECT * FROM auth_rate_limits WHERE scope='saml-callback'")).rowCount, 1);
    await db.query("UPDATE auth_rate_limits SET attempts=$1 WHERE scope='saml-callback'", [POLICIES["saml-callback"].limit]);
    await blocked(await http("/api/auth/saml/callback", { method: "POST", body: new URLSearchParams({ SAMLResponse: "invalid", RelayState: "x".repeat(43) }) }));
    const after = (await db.query(`SELECT (SELECT count(*)::int FROM saml_cache) AS cache,
      (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM user_sessions) AS sessions`)).rows[0];
    assert.deepEqual(after, before);
  } finally {
    await db.query("UPDATE workspace_security SET saml_mode=$1,saml_signin_url=$2,saml_certificate=$3 WHERE workspace_id=1",
      [previous.saml_mode, previous.saml_signin_url, previous.saml_certificate]);
  }
});

test("a global authentication quota cannot be bypassed by switching endpoint or spoofing peer headers", async () => {
  const user = await actor("global quota");
  await reserveAuthAttempt("global", "all-authentication", POLICIES.global, db);
  await db.query("UPDATE auth_rate_limits SET attempts=$1 WHERE scope='global'", [POLICIES.global.limit]);
  const before = (await db.query("SELECT totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_pending_secret;
  await blocked(await login(user, {}, { "x-forwarded-for": "192.0.2.100" }));
  await blocked(await http("/api/me/2fa", { method: "POST", cookie: user.cookie, json: { action: "begin" } }));
  await blocked(await http("/api/auth/saml/start"));
  await blocked(await http(`/api/invitations/${randomUUID()}`, { method: "POST", json: { name: "No bypass", password } }));
  assert.equal((await db.query("SELECT totp_pending_secret FROM users WHERE id=$1", [user.id])).rows[0].totp_pending_secret, before);
  // Logging out is a security action and must remain available while throttled.
  await request(user.cookie, "POST", "/api/auth/logout", 200);
});
