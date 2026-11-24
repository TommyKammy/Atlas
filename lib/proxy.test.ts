import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function request(path: string): NextRequest {
  return new NextRequest(`https://atlas.test${path}`);
}

test("OAuth discovery, token and registration endpoints stay public", async () => {
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource/mcp/readonly",
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/token",
    "/oauth/revoke",
  ]) {
    const response = await proxy(request(path));
    assert.equal(
      response.headers.get("x-middleware-next"),
      "1",
      `${path} must pass through without a session`,
    );
  }
});

test("the approval endpoint still requires a session", async () => {
  const response = await proxy(request("/oauth/authorize"));
  assert.equal(response.status, 307);
  const location = response.headers.get("location");
  assert.ok(location);
  assert.equal(new URL(location).pathname, "/login");
});
