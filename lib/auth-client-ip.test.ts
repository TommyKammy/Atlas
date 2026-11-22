import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTrustedProxies, resolveClientIp, stampAuthClientIp, verifiedAuthClientIp,
} from "./auth-client-ip.mjs";

const key = "a1".repeat(32);

function stamped(ip: string, forwardedFor?: string, trustedProxies?: string) {
  const request = {
    headers: {} as Record<string, string>,
    socket: { remoteAddress: ip },
  };
  if (forwardedFor !== undefined) request.headers["x-forwarded-for"] = forwardedFor;
  stampAuthClientIp(request, key, trustedProxies);
  return new Request("http://atlas.test/api/auth/login", { headers: request.headers });
}

function resolver(ip: string, forwardedFor?: string, trustedProxies?: string) {
  return resolveClientIp({
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress: ip },
  }, trustedProxies);
}

test("custom-server peer stamps validate and mapped IPv4 is normalized", () => {
  assert.equal(verifiedAuthClientIp(stamped("::ffff:127.0.0.1"), key), "127.0.0.1");
  assert.equal(verifiedAuthClientIp(stamped("::FFFF:127.0.0.1"), key), "127.0.0.1");
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

test("unset trusted proxies preserve the old direct-peer behavior", () => {
  assert.equal(resolver("203.0.113.9", "198.51.100.7"), "203.0.113.9");
  assert.equal(resolver("203.0.113.9", "198.51.100.7", ""), "203.0.113.9");
  assert.equal(verifiedAuthClientIp(stamped("203.0.113.9", "198.51.100.7"), key), "203.0.113.9");
});

test("an untrusted connection source cannot select an X-Forwarded-For identity", () => {
  assert.equal(resolver("203.0.113.9", "198.51.100.7", "10.0.0.0/8"), "203.0.113.9");
  assert.equal(
    verifiedAuthClientIp(stamped("203.0.113.9", "198.51.100.7", "10.0.0.0/8"), key),
    "203.0.113.9",
  );
});

test("a trusted source uses the rightmost untrusted hop and ignores spoofed left entries", () => {
  const trusted = "10.0.0.0/8,2001:db8:ffff::/48";
  assert.equal(
    resolver("10.0.0.5", "203.0.113.99, 198.51.100.7", trusted),
    "198.51.100.7",
  );
  assert.equal(
    resolver("::ffff:10.0.0.5", "203.0.113.99, 198.51.100.7", trusted),
    "198.51.100.7",
  );
  assert.equal(
    resolver("10.0.0.5", "203.0.113.99, 10.0.0.6, 198.51.100.7", trusted),
    "198.51.100.7",
  );
  assert.equal(
    verifiedAuthClientIp(stamped("10.0.0.5", "203.0.113.99, 198.51.100.7", trusted), key),
    "198.51.100.7",
  );
});

test("when every forwarded hop is trusted the leftmost address is the client", () => {
  assert.equal(resolver("10.0.0.5", "192.0.2.10, 10.0.0.6", "0.0.0.0/0"), "192.0.2.10");
  assert.equal(resolver("2001:db8::5", "2001:db8::10, 2001:db8::6", "::/0"), "2001:db8::10");
});

test("IPv6 peers and proxies are matched by prefix, including mapped forms", () => {
  assert.equal(resolver("2001:db8:1::5", "2001:db8:ff::9, 2001:db8:2::7", "2001:db8:1::/48"), "2001:db8:2::7");
  assert.equal(resolver("::ffff:10.0.0.5", "198.51.100.7", "::ffff:10.0.0.0/104"), "198.51.100.7");
  assert.equal(resolver("10.0.0.5", "198.51.100.7", "::ffff:10.0.0.0/104"), "198.51.100.7");
});

test("forwarded entries tolerate whitespace, ports and duplicate header values", () => {
  assert.equal(resolver("10.0.0.5", " 203.0.113.99 , 198.51.100.7 ", "10.0.0.0/8"), "198.51.100.7");
  assert.equal(resolver("10.0.0.5", "203.0.113.99, 198.51.100.7:443", "10.0.0.0/8"), "198.51.100.7");
  assert.equal(resolver("10.0.0.5", "203.0.113.99, [2001:db8::7]:8443", "10.0.0.0/8"), "2001:db8::7");
  const request = {
    headers: { "x-forwarded-for": ["203.0.113.99", "198.51.100.7"] },
    socket: { remoteAddress: "10.0.0.5" },
  };
  assert.equal(resolveClientIp(request, "10.0.0.0/8"), "198.51.100.7");
});

test("an unparseable forwarded hop fails closed to the connection source", () => {
  // The rightmost hop is the address the trusted proxy appended. If it is
  // unparseable, nothing to its left can be trusted either.
  assert.equal(resolver("10.0.0.5", "203.0.113.99, not-an-ip", "10.0.0.0/8"), "10.0.0.5");
  // A valid untrusted rightmost hop is enough, even if spoofed junk sits left.
  assert.equal(resolver("10.0.0.5", "not-an-ip, 203.0.113.99", "10.0.0.0/8"), "203.0.113.99");
  assert.equal(resolver("10.0.0.5", "", "10.0.0.0/8"), "10.0.0.5");
});

test("invalid trusted-proxy entries are reported and never grant trust", () => {
  const parsed = parseTrustedProxies("not-an-ip, 10.0.0.0/33, 2001:db8::/129, 10.0.0.0/8");
  assert.deepEqual(parsed.invalid, ["not-an-ip", "10.0.0.0/33", "2001:db8::/129"]);
  assert.deepEqual(parsed.entries, ["10.0.0.0/8"]);
  assert.equal(resolver("10.0.0.5", "198.51.100.7", "not-an-ip, 10.0.0.0/8"), "198.51.100.7");

  const allInvalid = parseTrustedProxies("not-an-ip, 10.0.0.0/33");
  assert.equal(allInvalid.list, null);
  assert.deepEqual(allInvalid.entries, []);
  assert.equal(resolver("10.0.0.5", "198.51.100.7", "not-an-ip, 10.0.0.0/33"), "10.0.0.5");

  const empty = parseTrustedProxies(" , ");
  assert.equal(empty.list, null);
  assert.deepEqual(empty.invalid, []);
});

test("invalid CIDR prefixes and mapped prefixes are rejected safely", () => {
  for (const value of ["10.0.0.0/", "10.0.0.0/-1", "10.0.0.0/8/9", "10.0.0.0/abc", "::ffff:192.0.2.0/95"]) {
    assert.equal(parseTrustedProxies(value).list, null, value);
  }
  const mapped = parseTrustedProxies("::ffff:192.0.2.0/120");
  assert.deepEqual(mapped.entries, ["192.0.2.0/24"]);
  assert.equal(resolver("192.0.2.1", "198.51.100.7", "::ffff:192.0.2.0/120"), "198.51.100.7");
});
