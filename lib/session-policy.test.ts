import assert from "node:assert/strict";
import test from "node:test";
import { isSamlSessionAllowed, type SamlMode } from "./session-policy";

test("SAML authentication provenance remains valid in every mode", () => {
  for (const mode of ["off", "optional", "required", "members_only"] as SamlMode[]) {
    for (const isAdmin of [false, true]) for (const isGuest of [false, true]) {
      assert.equal(isSamlSessionAllowed(mode, { isAdmin, isGuest }, "saml"), true);
    }
  }
});

test("mandatory SAML rejects password sessions only for the targeted users", () => {
  for (const isGuest of [false, true]) {
    assert.equal(isSamlSessionAllowed("required", { isAdmin: false, isGuest }, "password"), false);
    assert.equal(isSamlSessionAllowed("required", { isAdmin: true, isGuest }, "password"), true);
  }
  assert.equal(isSamlSessionAllowed("members_only", { isAdmin: false, isGuest: false }, "password"), false);
  assert.equal(isSamlSessionAllowed("members_only", { isAdmin: false, isGuest: true }, "password"), true);
});

test("off and optional modes preserve existing password sessions", () => {
  for (const mode of ["off", "optional"] as SamlMode[]) {
    assert.equal(isSamlSessionAllowed(mode, { isAdmin: false, isGuest: false }, "password"), true);
    assert.equal(isSamlSessionAllowed(mode, { isAdmin: false, isGuest: true }, "password"), true);
  }
});
