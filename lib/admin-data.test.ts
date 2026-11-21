import assert from "node:assert/strict";
import test from "node:test";
import { requiresSaml } from "./admin-data";

test("SAML policy uses the assigned role when legacy flags disagree", () => {
  // admin@example.com can exist as role_id=1 with is_admin=FALSE after a
  // partial seed or role backfill. The role must still grant the emergency
  // password exception.
  assert.equal(
    requiresSaml("required", { is_admin: false, is_guest: false, base_level: "admin" }),
    false,
  );
  assert.equal(
    requiresSaml("members_only", { is_admin: false, is_guest: false, base_level: "guest" }),
    false,
  );
  // A role also overrides stale flags in the opposite direction.
  assert.equal(
    requiresSaml("required", { is_admin: true, is_guest: false, base_level: "member" }),
    true,
  );
  assert.equal(
    requiresSaml("required", { is_admin: false, is_guest: false, base_level: "member" }),
    true,
  );
});

test("accounts without a role fall back to the legacy flags", () => {
  assert.equal(
    requiresSaml("required", { is_admin: true, is_guest: false, base_level: null }),
    false,
  );
  assert.equal(
    requiresSaml("required", { is_admin: false, is_guest: false, base_level: null }),
    true,
  );
  assert.equal(
    requiresSaml("members_only", { is_admin: false, is_guest: true, base_level: null }),
    false,
  );
});
