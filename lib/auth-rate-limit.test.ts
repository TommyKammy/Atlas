import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "./db";
import {
  AUTH_RATE_CLEANUP_BATCH, AuthRateLimitError, AuthRateLimitUnavailableError,
  POLICIES, authRateIdentityHash, authRateLimitResponse, cleanupAuthRateLimits,
  guardAuthRequest, reserveAuthAttempt,
} from "./auth-rate-limit";

function queryResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

test("authentication policies have bounded positive limits and shared MFA scope", () => {
  assert.deepEqual(POLICIES["mfa-verify"], { limit: 10, windowSeconds: 300 });
  assert.deepEqual(POLICIES["login-account"], { limit: 40, windowSeconds: 900 });
  assert.equal(POLICIES.global.limit, 6000);
  for (const policy of Object.values(POLICIES)) {
    assert.ok(Number.isSafeInteger(policy.limit) && policy.limit > 0);
    assert.ok(Number.isSafeInteger(policy.windowSeconds) && policy.windowSeconds > 0);
  }
});

test("rate subjects are scope-separated hashes rather than raw personal data", () => {
  const email = "private@example.test";
  const one = authRateIdentityHash("login-account", email);
  assert.match(one, /^[a-f0-9]{64}$/);
  assert.equal(one.includes(email), false);
  assert.equal(one, authRateIdentityHash("login-account", email));
  assert.notEqual(one, authRateIdentityHash("mfa-verify", email));
  assert.notEqual(authRateIdentityHash("a", "b:c"), authRateIdentityHash("a:b", "c"));
});

test("invalid rate policy cannot disable or overflow admission", async () => {
  const store: Queryable = { query: async () => assert.fail("invalid policy queried a database") };
  for (const policy of [{ limit: 0, windowSeconds: 1 }, { limit: -1, windowSeconds: 1 },
    { limit: 1.5, windowSeconds: 1 }, { limit: Infinity, windowSeconds: 1 },
    { limit: 1, windowSeconds: 0 }, { limit: 1, windowSeconds: 86401 }]) {
    await assert.rejects(reserveAuthAttempt("login-account", "test", policy, store), /invalid authentication rate policy/);
  }
  await assert.rejects(reserveAuthAttempt("bad scope", "test", { limit: 1, windowSeconds: 1 }, store), TypeError);
});

test("a rejected reservation returns a stable retry interval and no cookie", async () => {
  const store: Queryable = { query: async (sql) => queryResult(sql.startsWith("SELECT greatest") ? [{ retry_after: 17 }] : []) };
  let rejected: unknown;
  try { await reserveAuthAttempt("login-account", "test", { limit: 1, windowSeconds: 20 }, store); }
  catch (error) { rejected = error; }
  assert.ok(rejected instanceof AuthRateLimitError);
  const response = authRateLimitResponse(rejected)!;
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: "too_many_attempts", retry_after_seconds: 17 });
});

test("refund is one-time, concurrent-safe and fenced by its random window generation", async () => {
  const refunds: unknown[][] = [];
  const windowId = "5d1c1f84-1dc4-48d8-a5f3-2840cf81bad7";
  const store: Queryable = { query: async (sql, params) => {
    if (sql.startsWith("UPDATE")) refunds.push(params!);
    return queryResult(sql.startsWith("INSERT") ? [{ window_id: windowId }] : []);
  } };
  const ticket = await reserveAuthAttempt("login-account", "test", { limit: 2, windowSeconds: 20 }, store);
  await Promise.all([ticket.release(), ticket.release(), ticket.release()]);
  assert.equal(refunds.length, 1);
  assert.deepEqual(refunds[0], ["login-account", authRateIdentityHash("login-account", "test"), windowId]);
});

test("database outages fail authentication closed without leaking backend details", async () => {
  const store: Queryable = { query: async () => { throw new Error("secret DSN and credentials"); } };
  let unavailable: unknown;
  try { await reserveAuthAttempt("login-account", "test", { limit: 1, windowSeconds: 20 }, store); }
  catch (error) { unavailable = error; }
  assert.ok(unavailable instanceof AuthRateLimitUnavailableError);
  const response = authRateLimitResponse(unavailable)!;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: "auth_temporarily_unavailable" });
});

test("successful verification can refund inside its credential transaction", async () => {
  let ordinaryRefunds = 0;
  let transactionRefunds = 0;
  const store: Queryable = { query: async (sql) => {
    if (sql.startsWith("UPDATE")) ordinaryRefunds++;
    return queryResult(sql.startsWith("INSERT") ? [{ window_id: "5d1c1f84-1dc4-48d8-a5f3-2840cf81bad7" }] : []);
  } };
  const transaction: Queryable = { query: async () => { transactionRefunds++; return queryResult([]); } };
  const ticket = await reserveAuthAttempt("mfa-verify", "user:1", POLICIES["mfa-verify"], store);
  await ticket.release(transaction);
  assert.equal(transactionRefunds, 1);
  assert.equal(ordinaryRefunds, 0);
});

test("a failed refund remains fail-closed and cannot repeat the decrement", async () => {
  let refunds = 0;
  const store: Queryable = { query: async (sql) => {
    if (sql.startsWith("UPDATE")) { refunds++; throw new Error("database unavailable"); }
    return queryResult(sql.startsWith("INSERT") ? [{ window_id: "5d1c1f84-1dc4-48d8-a5f3-2840cf81bad7" }] : []);
  } };
  const ticket = await reserveAuthAttempt("login-account", "test", { limit: 2, windowSeconds: 20 }, store);
  await assert.rejects(ticket.release(), AuthRateLimitUnavailableError);
  await ticket.release();
  assert.equal(refunds, 1);
});

test("cleanup has a fixed batch bound and surfaces database failures", async () => {
  const queries: unknown[][] = [];
  await cleanupAuthRateLimits({ query: async (_sql, params) => { queries.push(params!); return queryResult([]); } });
  assert.deepEqual(queries, [[AUTH_RATE_CLEANUP_BATCH]]);
  await assert.rejects(cleanupAuthRateLimits({ query: async () => { throw new Error("failed"); } }), AuthRateLimitUnavailableError);
});

test("unauthenticated endpoints share one global quota and ignore forged forwarding headers", async () => {
  const buckets: unknown[][] = [];
  const store: Queryable = { query: async (sql, params) => {
    if (sql.startsWith("INSERT")) buckets.push(params!);
    return queryResult(sql.startsWith("INSERT") ? [{ window_id: "5d1c1f84-1dc4-48d8-a5f3-2840cf81bad7" }] : []);
  } };
  for (const endpoint of ["login", "saml-start", "invitation"]) {
    await guardAuthRequest(new Request("http://atlas.test", {
      headers: { "x-forwarded-for": `192.0.2.${buckets.length + 1}`, "x-real-ip": "198.51.100.1" },
    }), endpoint, store);
  }
  assert.equal(buckets.length, 3);
  assert.equal(new Set(buckets.map((params) => JSON.stringify(params))).size, 1);
  assert.equal(buckets[0][0], "global");
});

test("response helper does not swallow unrelated errors", () => {
  assert.equal(authRateLimitResponse(new Error("unrelated")), null);
  assert.equal(authRateLimitResponse(null), null);
});
