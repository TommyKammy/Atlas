import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCIM_DELETED_REACTIVATE_MESSAGE,
  SCIM_PROFILE_LOCK_MESSAGE,
  SCIM_REACTIVATE_MESSAGE,
  scimManagedChangeError,
  scimUserState,
  type ScimManagedProfile,
} from "./managed-user";

const target: ScimManagedProfile = {
  scimEnabled: true,
  scimManaged: true,
  scimDeleted: false,
  deactivated: false,
  name: "SCIM User",
  email: "scim@example.com",
  title: "Engineer",
};

test("unmanaged and SCIM-disabled users keep every profile edit", () => {
  assert.equal(scimManagedChangeError({ ...target, scimManaged: false }, {
    name: "Renamed",
    email: "other@example.com",
    title: "Manager",
    deactivated: false,
  }), null);
  assert.equal(scimManagedChangeError({ ...target, scimEnabled: false, deactivated: true }, {
    name: "Renamed",
    email: "other@example.com",
    title: "Manager",
    deactivated: false,
  }), null);
});

test("active managed users cannot change name, email or title", () => {
  assert.equal(scimManagedChangeError(target, { name: "Renamed" }), SCIM_PROFILE_LOCK_MESSAGE);
  assert.equal(scimManagedChangeError(target, { email: "other@example.com" }), SCIM_PROFILE_LOCK_MESSAGE);
  assert.equal(scimManagedChangeError(target, { title: "Manager" }), SCIM_PROFILE_LOCK_MESSAGE);
});

test("a deleted binding no longer locks the profile fields", () => {
  const deleted = { ...target, scimDeleted: true };
  assert.equal(scimManagedChangeError(deleted, { name: "Renamed" }), null);
  assert.equal(scimManagedChangeError(deleted, { email: "other@example.com" }), null);
  assert.equal(scimManagedChangeError(deleted, { title: "Manager" }), null);
});

test("unchanged values and email case differences are allowed", () => {
  assert.equal(scimManagedChangeError(target, {
    name: " SCIM User ",
    email: "SCIM@Example.com",
    title: "Engineer",
  }), null);
});

test("deactivation is allowed but reactivation has a binding-aware message", () => {
  assert.equal(scimManagedChangeError(target, { deactivated: true }), null);
  assert.equal(scimManagedChangeError({ ...target, deactivated: true }, {
    deactivated: false,
  }), SCIM_REACTIVATE_MESSAGE);
  assert.equal(scimManagedChangeError({
    ...target,
    scimDeleted: true,
    deactivated: true,
  }, {
    deactivated: false,
  }), SCIM_DELETED_REACTIVATE_MESSAGE);
  assert.equal(scimManagedChangeError(target, { deactivated: false }), null);
});

test("fields managed elsewhere, such as roles and passwords, are unaffected", () => {
  const otherFields = {
    role: "guest",
    password: "new secret",
    avatar_url: "https://example.com/a.png",
  } as unknown as Parameters<typeof scimManagedChangeError>[1];
  assert.equal(scimManagedChangeError(target, otherFields), null);
  assert.equal(SCIM_PROFILE_LOCK_MESSAGE.includes("IdP"), true);
  assert.equal(SCIM_REACTIVATE_MESSAGE.includes("有効化"), true);
  assert.equal(SCIM_DELETED_REACTIVATE_MESSAGE.includes("IdP で割り当て直"), true);
});

test("scimUserState distinguishes active, deleted, disabled and unmanaged rows", () => {
  assert.equal(scimUserState({}), null);
  assert.equal(scimUserState({ scim_managed: false, scim_enabled: true }), null);
  assert.equal(scimUserState({
    scim_managed: true, scim_deleted: false, scim_enabled: true,
  }), "active");
  assert.equal(scimUserState({
    scim_managed: true, scim_deleted: true, scim_enabled: true,
  }), "deleted");
  assert.equal(scimUserState({
    scim_managed: true, scim_deleted: true, scim_enabled: false,
  }), "disabled");
});
