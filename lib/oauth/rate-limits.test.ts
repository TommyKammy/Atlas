import assert from "node:assert/strict";
import { test } from "node:test";
import { POLICIES } from "@/lib/auth-rate-limit";

test("OAuth token and registration policies match the plan", () => {
  assert.deepEqual(POLICIES["oauth-token"], { limit: 30, windowSeconds: 60 });
  assert.deepEqual(POLICIES["oauth-register"], { limit: 10, windowSeconds: 60 * 60 });
});
