import assert from "node:assert/strict";
import test from "node:test";
import { stampAuthClientIp, verifiedAuthClientIp } from "./auth-client-ip.mjs";

const key = "a1".repeat(32);
function stamped(ip: string) {
  const request = { headers: {} as Record<string, string>, socket: { remoteAddress: ip } };
  stampAuthClientIp(request, key);
  return new Request("http://atlas.test/api/auth/login", { headers: request.headers });
}

test("custom-server peer stamps validate and mapped IPv4 is normalized", () => {
  assert.equal(verifiedAuthClientIp(stamped("::ffff:127.0.0.1"), key), "127.0.0.1");
  assert.equal(verifiedAuthClientIp(stamped("2001:db8::1"), key), "2001:db8::1");
});

test("spoofed peer and forwarded headers cannot choose a limiter identity", () => {
  const headers = { "x-atlas-auth-client-ip": "192.0.2.1", "x-atlas-auth-client-proof": "0".repeat(64), "x-forwarded-for": "192.0.2.2" };
  assert.equal(verifiedAuthClientIp(new Request("http://atlas.test", { headers }), key), null);
  const request = { headers, socket: { remoteAddress: "127.0.0.1" } };
  stampAuthClientIp(request, key);
  assert.equal(verifiedAuthClientIp(new Request("http://atlas.test", { headers: request.headers }), key), "127.0.0.1");
});

test("missing or changed server signing keys and tampered peer fail closed", () => {
  const request = stamped("127.0.0.1");
  assert.equal(verifiedAuthClientIp(request, ""), null);
  assert.equal(verifiedAuthClientIp(request, "b2".repeat(32)), null);
  request.headers.set("x-atlas-auth-client-ip", "192.0.2.3");
  assert.equal(verifiedAuthClientIp(request, key), null);
});

test("invalid peer clears attacker headers instead of forwarding a proof", () => {
  const request = { headers: { "x-atlas-auth-client-ip": "192.0.2.1", "x-atlas-auth-client-proof": "forged" }, socket: { remoteAddress: "invalid" } };
  stampAuthClientIp(request, key);
  assert.deepEqual(request.headers, {});
});
