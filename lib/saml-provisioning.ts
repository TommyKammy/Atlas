/**
 * SCIM is the authoritative provisioning channel while it is enabled. Even if
 * the legacy SAML JIT flag is still true, an unknown assertion identity must
 * not create an account behind SCIM's back.
 */
export function shouldProvisionSamlUser(
  settings: { saml_jit_provisioning: boolean; scim_enabled: boolean },
): boolean {
  return settings.saml_jit_provisioning && !settings.scim_enabled;
}
