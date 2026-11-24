import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appBaseUrl,
  isSupportedResource,
  mcpResourceUrl,
  MissingPublicBaseUrlError,
  requestBaseUrl,
  resourceMatchesEndpoint,
} from "./resources";
import {
  authorizationServerMetadataResponse,
  protectedResourceMetadataResponse,
} from "./metadata";

test("the resource base prefers APP_URL and falls back to APP_ORIGIN", () => {
  assert.equal(
    appBaseUrl({ APP_URL: "https://atlas.example/path", APP_ORIGIN: "https://origin.example" }),
    "https://atlas.example",
  );
  assert.equal(appBaseUrl({ APP_ORIGIN: "https://origin.example/" }), "https://origin.example");
  assert.equal(appBaseUrl({ APP_URL: "file:///tmp/x", APP_ORIGIN: "https://origin.example" }), "https://origin.example");
  assert.equal(appBaseUrl({ APP_URL: "https://user:pass@atlas.example" }), null);
  assert.equal(appBaseUrl({}), null);
});

test("the two MCP audiences are built from the configured base", () => {
  const env = { APP_URL: "https://atlas.example" };
  assert.equal(mcpResourceUrl("default", env), "https://atlas.example/mcp");
  assert.equal(mcpResourceUrl("readonly", env), "https://atlas.example/mcp/readonly");
  assert.equal(mcpResourceUrl("default", {}), null);
});

test("audience comparison is exact and rejects other endpoints", () => {
  const env = { APP_URL: "https://atlas.example" };
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp", "default", env), true);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp", "readonly", env), false);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp/readonly", "readonly", env), true);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp/readonly", "default", env), false);
  assert.equal(resourceMatchesEndpoint("https://other.example/mcp", "default", env), false);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp?x=1", "default", env), false);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp#x", "default", env), false);
  assert.equal(resourceMatchesEndpoint(null, "default", env), false);
  assert.equal(resourceMatchesEndpoint("https://atlas.example/mcp", "default", {}), false);
});

test("supported resources cover exactly the two MCP endpoints", () => {
  const env = { APP_URL: "https://atlas.example" };
  assert.equal(isSupportedResource("https://atlas.example/mcp", env), true);
  assert.equal(isSupportedResource("https://atlas.example/mcp/readonly", env), true);
  assert.equal(isSupportedResource("https://atlas.example/other", env), false);
  assert.equal(isSupportedResource(undefined, env), false);
});

test("development accepts the endpoint paths when no public origin is configured", () => {
  const env = { NODE_ENV: "development", APP_URL: undefined, APP_ORIGIN: undefined };
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/mcp", "default", env), true);
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/mcp/readonly", "readonly", env), true);
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/mcp/readonly", "default", env), false);
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/other", "default", env), false);
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/mcp?x=1", "default", env), false);
  assert.equal(resourceMatchesEndpoint("http://127.0.0.1:3000/mcp", "default", {}), false);
});

test("production refuses to derive the public origin from the request host", (t) => {
  const logged = t.mock.method(console, "error", () => undefined);
  const request = new Request(
    "https://evil.example/.well-known/oauth-protected-resource/mcp",
  );
  assert.throws(
    () => requestBaseUrl(request, { NODE_ENV: "production" }),
    MissingPublicBaseUrlError,
  );
  assert.equal(logged.mock.callCount(), 1);

  // Both metadata documents fail closed instead of advertising the Host.
  for (const response of [
    protectedResourceMetadataResponse(request, "default", { NODE_ENV: "production" }),
    authorizationServerMetadataResponse(request, { NODE_ENV: "production" }),
  ]) {
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }

  // An explicit production origin still wins over the incoming Host.
  assert.equal(
    requestBaseUrl(request, { NODE_ENV: "production", APP_URL: "https://atlas.example" }),
    "https://atlas.example",
  );
});
