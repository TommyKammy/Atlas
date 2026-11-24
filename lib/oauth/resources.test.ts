import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appBaseUrl,
  isSupportedResource,
  mcpResourceUrl,
  resourceMatchesEndpoint,
} from "./resources";

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
