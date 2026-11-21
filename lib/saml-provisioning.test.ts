import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldProvisionSamlUser } from "./saml-provisioning";

test("SAML JIT follows its own setting while SCIM is disabled", () => {
  assert.equal(shouldProvisionSamlUser({ saml_jit_provisioning: true, scim_enabled: false }), true);
  assert.equal(shouldProvisionSamlUser({ saml_jit_provisioning: false, scim_enabled: false }), false);
});

test("SCIM ownership always disables SAML JIT", () => {
  assert.equal(shouldProvisionSamlUser({ saml_jit_provisioning: true, scim_enabled: true }), false);
  assert.equal(shouldProvisionSamlUser({ saml_jit_provisioning: false, scim_enabled: true }), false);
});
