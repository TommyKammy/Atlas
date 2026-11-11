import assert from "node:assert/strict";
import { test } from "node:test";
import { canChangeProjectMember, canConfigureProject, canShareProject, projectPatchRequiresAdmin } from "./project-policy";
import { normalizeProjectRole } from "./project-roles";

test("configuration policy is independent of ordinary task editing and retains legacy editor defaults", () => {
  assert.equal(canConfigureProject("editor", {}), true);
  assert.equal(canConfigureProject(normalizeProjectRole("member"), {}), true);
  assert.equal(canConfigureProject("editor", { who_can_edit: "admins" }), false);
  assert.equal(canConfigureProject("admin", { who_can_edit: "admins" }), true);
  for (const role of [null, "viewer", "commenter"] as const) assert.equal(canConfigureProject(role, { who_can_edit: "editors" }), false);
  assert.equal(canConfigureProject("editor", { who_can_edit: "invalid" }), true);
});

test("sharing policy defaults to admins and delegates only to editors", () => {
  assert.equal(canShareProject("editor", undefined), false);
  assert.equal(canShareProject("editor", { who_can_share: "editors" }), true);
  assert.equal(canShareProject(normalizeProjectRole("member"), { who_can_share: "editors" }), true);
  assert.equal(canShareProject("admin", null), true);
  for (const role of [null, "viewer", "commenter"] as const) assert.equal(canShareProject(role, { who_can_share: "editors" }), false);
});

test("delegated sharing cannot grant or manage admin access or mutate its own role", () => {
  assert.equal(canChangeProjectMember("editor", 2, 3, null, "viewer"), true);
  assert.equal(canChangeProjectMember("editor", 2, 3, "editor", "commenter"), true);
  assert.equal(canChangeProjectMember("editor", 2, 3, "viewer", null), true);
  assert.equal(canChangeProjectMember("editor", 2, 3, null, "admin"), false);
  assert.equal(canChangeProjectMember("editor", 2, 3, "admin", "viewer"), false);
  assert.equal(canChangeProjectMember("editor", 2, 3, "viewer", null, true), false);
  assert.equal(canChangeProjectMember("editor", 2, 2, "editor", "viewer"), false);
  assert.equal(canChangeProjectMember("admin", 2, 3, "admin", null, true), true);
});

test("administration fields stay protected even in mixed configuration patches", () => {
  assert.equal(projectPatchRequiresAdmin({ color: "blue", status: "active" }), false);
  for (const key of ["settings", "owner_id", "team_id", "archived"]) assert.equal(projectPatchRequiresAdmin({ color: "blue", [key]: null }), true);
});
