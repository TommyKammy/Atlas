import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KEEPALIVE_TIMEOUT_MS, HEADERS_TIMEOUT_HEADROOM_MS, keepAliveTimeouts, resolveKeepAliveTimeout,
} from "./server-keepalive.mjs";

test("keep-alive defaults are longer than the NGINX upstream idle timeout", () => {
  assert.equal(DEFAULT_KEEPALIVE_TIMEOUT_MS, 65_000);
  assert.equal(resolveKeepAliveTimeout(undefined), 65_000);
  assert.equal(resolveKeepAliveTimeout(""), 65_000);
});

test("valid keep-alive values are used and headersTimeout stays above them", () => {
  assert.equal(resolveKeepAliveTimeout("90000"), 90_000);
  assert.deepEqual(keepAliveTimeouts("70000"), {
    keepAliveTimeout: 70_000,
    headersTimeout: 70_000 + HEADERS_TIMEOUT_HEADROOM_MS,
  });
  const defaults = keepAliveTimeouts(undefined);
  assert.ok(defaults.headersTimeout > defaults.keepAliveTimeout);
});

test("invalid keep-alive values fall back to the default", () => {
  for (const value of ["abc", "65s", "-1", "0", "1.5", "999999999999999999999", "  "]) {
    assert.equal(resolveKeepAliveTimeout(value), DEFAULT_KEEPALIVE_TIMEOUT_MS, String(value));
  }
  assert.equal(resolveKeepAliveTimeout("3600001"), DEFAULT_KEEPALIVE_TIMEOUT_MS);
});
