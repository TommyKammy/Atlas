export type SessionAuthMethod = "password" | "saml";
export type SamlMode = "off" | "optional" | "required" | "members_only";

/** Administrators retain the existing emergency password sign-in exception. */
export function isSamlSessionAllowed(
  mode: SamlMode,
  user: { isAdmin: boolean; isGuest: boolean },
  method: SessionAuthMethod,
): boolean {
  return method === "saml" || user.isAdmin || mode === "off" || mode === "optional"
    || (mode === "members_only" && user.isGuest);
}

/** An internal session insert was refused after a concurrent SAML policy change. */
export class SamlSessionRequiredError extends Error {
  constructor() {
    super("SAML SSO is required for this workspace");
    this.name = "SamlSessionRequiredError";
  }
}
