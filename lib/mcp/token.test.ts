import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MCP_TOKEN_PREFIX, bearerToken, generateMcpToken, hashMcpToken, isMcpToken,
  mcpTokenMatchesHash, shouldTouchLastUsed,
} from "./token";

test("MCP tokens are atlas_mcp_ plus 32 random bytes in base64url", () => {
  const token = generateMcpToken();
  assert.ok(token.startsWith(MCP_TOKEN_PREFIX));
  assert.match(token.slice(MCP_TOKEN_PREFIX.length), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isMcpToken(token), true);
  assert.notEqual(token, generateMcpToken());
});

test("malformed MCP tokens are rejected before hashing", () => {
  assert.equal(isMcpToken("atlas_mcp_short"), false);
  assert.equal(isMcpToken("atlas_mcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"), false);
  assert.equal(isMcpToken("atlas_scim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(isMcpToken("atlas_mcp_"), false);
});

test("only the SHA-256 hash is stable and comparison is constant-time-safe", () => {
  const token = generateMcpToken();
  const hash = hashMcpToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashMcpToken(token));
  assert.equal(mcpTokenMatchesHash(hash, hash), true);
  assert.equal(mcpTokenMatchesHash(hash, hashMcpToken(generateMcpToken())), false);
  assert.equal(mcpTokenMatchesHash(hash, "short"), false);
  assert.equal(hash.includes(token), false);
});

test("bearer parsing accepts the standard scheme only", () => {
  assert.equal(bearerToken("Bearer atlas_mcp_abc"), "atlas_mcp_abc");
  assert.equal(bearerToken("bearer   token  "), "token");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken(null), null);
});

test("last_used_at is written at most once a minute", () => {
  const now = Date.parse("2026-01-01T00:01:00.000Z");
  assert.equal(shouldTouchLastUsed(null, now), true);
  assert.equal(shouldTouchLastUsed(new Date(now - 59_000), now), false);
  assert.equal(shouldTouchLastUsed(new Date(now - 60_000), now), true);
  assert.equal(shouldTouchLastUsed("not-a-date", now), true);
});
