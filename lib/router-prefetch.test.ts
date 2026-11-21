import assert from "node:assert/strict";
import { test } from "node:test";
import { isRouterPrefetch } from "./router-prefetch";

const req = (values: Record<string, string>) => new Headers(values);

test("router prefetches of every kind are detected", () => {
  for (const kind of ["1", "2", "3"]) {
    assert.equal(isRouterPrefetch(req({ rsc: "1", "next-router-prefetch": kind })), true, kind);
  }
  assert.equal(isRouterPrefetch(req({ rsc: "1", "next-router-segment-prefetch": "/_tree" })), true);
});

test("navigations and full page loads are not prefetches", () => {
  assert.equal(isRouterPrefetch(req({ rsc: "1" })), false);
  assert.equal(isRouterPrefetch(req({})), false);
  assert.equal(isRouterPrefetch(req({ accept: "text/html" })), false);
  // Without the RSC header Next renders a normal document, so a stray
  // prefetch header on a page load must not suppress the visit.
  assert.equal(isRouterPrefetch(req({ "next-router-prefetch": "1" })), false);
});
