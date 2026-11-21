import assert from "node:assert/strict";
import { test } from "node:test";
import { ScimApiError } from "./errors";
import {
  hasScimNameInput, scimActiveFromPayload, scimEmailFromPayload, scimExternalIdFromPayload,
  scimNameFromPayload, scimTitleFromPayload, scimUserNameFromPayload, scimUserResource,
  userNameDrivesEmail,
} from "./map";
import { mergeScimName } from "./patch";

test("email prefers primary/work emails, then userName", () => {
  assert.equal(scimEmailFromPayload({
    userName: "fallback@example.com",
    emails: [
      { value: "home@example.com", type: "home" },
      { value: "Work@Example.com", type: "work" },
    ],
  }), "work@example.com");
  assert.equal(scimEmailFromPayload({
    userName: "fallback@example.com",
    emails: [{ value: "secondary@example.com" }, { value: "primary@example.com", primary: true }],
  }), "primary@example.com");
  assert.equal(scimEmailFromPayload({ userName: "Name@Example.com" }), "name@example.com");
});

test("missing or malformed email is invalidValue", () => {
  for (const body of [
    {},
    { userName: "" },
    { userName: "not-an-email" },
    { emails: [{ value: "nope" }] },
  ]) {
    assert.throws(() => scimEmailFromPayload(body), (error) => {
      assert.ok(error instanceof ScimApiError);
      assert.equal(error.status, 400);
      assert.equal(error.scimType, "invalidValue");
      return true;
    });
  }
});

test("a UPN userName and a work email remain separate values", () => {
  const body = {
    userName: "taro@corp.onmicrosoft.com",
    emails: [{ value: "Taro@Corp.com", type: "work", primary: true }],
  };
  assert.equal(scimUserNameFromPayload(body), "taro@corp.onmicrosoft.com");
  assert.equal(scimEmailFromPayload(body), "taro@corp.com");
});

test("userName is only the email fallback when emails is absent", () => {
  assert.equal(scimEmailFromPayload({ userName: "Taro@Corp.com" }), "taro@corp.com");
  assert.throws(() => scimEmailFromPayload({
    userName: "taro@corp.onmicrosoft.com",
    emails: [],
  }), /emails must contain a usable email address/);
});

test("email follows userName only when the current email was derived from it", () => {
  assert.equal(userNameDrivesEmail("taro@corp.com", "taro@corp.com"), true);
  assert.equal(userNameDrivesEmail("TARO@corp.com", "taro@corp.com"), true);
  assert.equal(userNameDrivesEmail("taro@corp.com", "taro@corp.onmicrosoft.com"), false);
  assert.equal(userNameDrivesEmail("", "taro@corp.com"), false);
  assert.equal(userNameDrivesEmail("taro@corp.com", null), false);
});

test("name priority is formatted, displayName, given+family, email local part", () => {
  assert.equal(scimNameFromPayload({
    name: { formatted: "Formatted Name", givenName: "Given", familyName: "Family" },
    displayName: "Display",
  }, "mail@example.com"), "Formatted Name");
  assert.equal(scimNameFromPayload({
    name: { givenName: "Given", familyName: "Family" },
    displayName: "Display",
  }, "mail@example.com"), "Display");
  assert.equal(scimNameFromPayload({ name: { givenName: "Given", familyName: "Family" } },
    "mail@example.com"), "Given Family");
  assert.equal(scimNameFromPayload({}, "local.part@example.com"), "local.part");
});

test("name is capped at 120 characters", () => {
  assert.equal(scimNameFromPayload({ displayName: "x".repeat(200) }, "a@example.com").length, 120);
});

test("changing only familyName keeps the stored givenName", () => {
  const merged = mergeScimName({
    formatted: null, givenName: "Taro", familyName: "Yamada", displayName: null,
  }, { familyName: "Suzuki" }, "taro@example.com");
  assert.equal(merged.name, "Taro Suzuki");
  assert.deepEqual(merged.state, {
    formatted: null, givenName: "Taro", familyName: "Suzuki", displayName: null,
  });
});

test("formatted and displayName still take priority over name parts", () => {
  const current = {
    formatted: "Taro Yamada", givenName: "Taro", familyName: "Yamada", displayName: null,
  };
  assert.equal(mergeScimName(current, { familyName: "Suzuki" }, "taro@example.com").name, "Taro Yamada");
  assert.equal(mergeScimName({
    formatted: null, givenName: "Taro", familyName: "Suzuki", displayName: "Taro S.",
  }, {}, "taro@example.com").name, "Taro S.");
});

test("hasScimNameInput only reports supported name input", () => {
  assert.equal(hasScimNameInput({ displayName: "" }), true);
  assert.equal(hasScimNameInput({ name: { givenName: "A" } }), true);
  assert.equal(hasScimNameInput({ name: { middleName: "A" } }), false);
  assert.equal(hasScimNameInput({ title: "A" }), false);
});

test("active defaults to true; title and externalId are normalized", () => {
  assert.equal(scimActiveFromPayload({}), true);
  assert.equal(scimActiveFromPayload({ active: "False" }), false);
  assert.equal(scimTitleFromPayload({ title: "  Lead  " }), "Lead");
  assert.equal(scimTitleFromPayload({}), undefined);
  assert.equal(scimExternalIdFromPayload({}), undefined);
  assert.equal(scimExternalIdFromPayload({ externalId: "  abc  " }), "abc");
  assert.equal(scimExternalIdFromPayload({ externalId: null }), null);
});

test("the SCIM resource exposes only supported attributes and metadata", () => {
  const resource = scimUserResource({
    id: 42,
    name: "Alice Example",
    email: "alice@example.com",
    title: "Engineer",
    deactivated_at: "2026-01-02 03:04:05+00",
    created_at: "2026-01-01T00:00:00.000Z",
    external_id: "entra-42",
    identity_user_name: "alice@corp.onmicrosoft.com",
    identity_given_name: "Alice",
    identity_family_name: "Example",
    identity_formatted_name: "Alice Example",
    identity_updated_at: "2026-01-03T00:00:00.000Z",
  }, "https://atlas.example");
  assert.deepEqual(resource.schemas, ["urn:ietf:params:scim:schemas:core:2.0:User"]);
  assert.equal(resource.id, "42");
  assert.equal(resource.externalId, "entra-42");
  assert.equal(resource.userName, "alice@corp.onmicrosoft.com");
  assert.deepEqual(resource.name, {
    formatted: "Alice Example", givenName: "Alice", familyName: "Example",
  });
  assert.equal(resource.displayName, "Alice Example");
  assert.deepEqual(resource.emails, [{ value: "alice@example.com", type: "work", primary: true }]);
  assert.equal(resource.title, "Engineer");
  assert.equal(resource.active, false);
  assert.deepEqual(resource.meta, {
    resourceType: "User",
    created: "2026-01-01T00:00:00.000Z",
    lastModified: "2026-01-03T00:00:00.000Z",
    location: "https://atlas.example/scim/v2/Users/42",
  });
});

test("lastModified falls back to users.created_at for unmanaged users", () => {
  const resource = scimUserResource({
    id: 7,
    name: "Legacy",
    email: "legacy@example.com",
    title: "",
    deactivated_at: null,
    created_at: new Date("2026-02-01T00:00:00.000Z"),
  }, "https://atlas.example");
  assert.equal(resource.meta.lastModified, "2026-02-01T00:00:00.000Z");
  assert.equal(resource.active, true);
  assert.equal("externalId" in resource, false);
  assert.equal(resource.userName, "legacy@example.com");
});
