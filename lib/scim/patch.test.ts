import assert from "node:assert/strict";
import { test } from "node:test";
import { ScimApiError } from "./errors";
import {
  applyScimPatch, emailFromEmails, parseScimBoolean, type ScimPatchOperation,
} from "./patch";

test("Entra's capitalized Replace and string False are accepted", () => {
  const fields = applyScimPatch([{ op: "Replace", path: "active", value: "False" }]);
  assert.deepEqual(fields, { active: false });
});

test("booleans are accepted as booleans and True/False strings", () => {
  assert.equal(parseScimBoolean(true), true);
  assert.equal(parseScimBoolean("True"), true);
  assert.equal(parseScimBoolean("FALSE"), false);
  assert.equal(parseScimBoolean("yes"), undefined);
  assert.equal(parseScimBoolean(1), undefined);
});

test("a path-less value object applies its supported attributes", () => {
  const fields = applyScimPatch([{
    op: "replace",
    value: {
      active: false,
      displayName: "Alice Example",
      name: { givenName: "Alice", familyName: "Example" },
      title: "Engineer",
      externalId: "entra-1",
    },
  }]);
  assert.deepEqual(fields, {
    name: { givenName: "Alice", familyName: "Example", displayName: "Alice Example" },
    title: "Engineer",
    externalId: "entra-1",
    active: false,
  });
});

test("conditional work-email path replaces the account email", () => {
  const fields = applyScimPatch([{
    op: "replace",
    path: 'emails[type eq "work"].value',
    value: "  Alice@Example.com ",
  }]);
  assert.deepEqual(fields, { email: "alice@example.com" });
});

test("emails array prefers primary, then work", () => {
  assert.equal(emailFromEmails([
    { value: "home@example.com", type: "home" },
    { value: "work@example.com", type: "work" },
    { value: "primary@example.com", type: "work", primary: true },
  ]), "primary@example.com");
  assert.equal(emailFromEmails([
    { value: "home@example.com", type: "home" },
    { value: "work@example.com", type: "WORK" },
  ]), "work@example.com");
});

test("remove title clears it and unsupported enterprise attributes are ignored", () => {
  assert.deepEqual(applyScimPatch([{ op: "remove", path: "title" }]), { title: "" });
  assert.deepEqual(applyScimPatch([{
    op: "replace",
    path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
    value: "Sales",
  }]), {});
  assert.deepEqual(applyScimPatch([{
    op: "add",
    value: { "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { manager: "x" } },
  }]), {});
});

test("name.givenName and name.familyName are kept as separate stored parts", () => {
  assert.deepEqual(applyScimPatch([
    { op: "replace", path: "name.givenName", value: "Alice" },
    { op: "Replace", path: "name.familyName", value: "Example" },
  ]), { name: { givenName: "Alice", familyName: "Example" } });
});

test("userName is stored separately from the Atlas email", () => {
  assert.deepEqual(applyScimPatch([{
    op: "replace", path: "userName", value: "taro@corp.onmicrosoft.com",
  }]), { userName: "taro@corp.onmicrosoft.com" });
  assert.deepEqual(applyScimPatch([
    { op: "replace", path: "userName", value: "taro@corp.onmicrosoft.com" },
    { op: "replace", path: 'emails[type eq "work"].value', value: "taro@corp.com" },
  ]), { userName: "taro@corp.onmicrosoft.com", email: "taro@corp.com" });
  assert.deepEqual(applyScimPatch([{
    op: "replace",
    value: { userName: "taro@corp.onmicrosoft.com", emails: [{ value: "taro@corp.com", type: "work" }] },
  }]), { userName: "taro@corp.onmicrosoft.com", email: "taro@corp.com" });
});

test("invalid op, active, userName and email raise SCIM errors", () => {
  for (const operations of [
    [{ op: "merge", path: "title", value: "x" } as ScimPatchOperation],
    [{ op: "replace", path: "active", value: "maybe" }],
    [{ op: "replace", path: "userName", value: "" }],
    [{ op: "replace", path: "emails.value", value: "not-an-email" }],
  ]) {
    assert.throws(() => applyScimPatch(operations), (error) => {
      assert.ok(error instanceof ScimApiError);
      assert.equal(error.status, 400);
      return true;
    });
  }
});
