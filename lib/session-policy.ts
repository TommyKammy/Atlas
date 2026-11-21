export type SessionAuthMethod = "password" | "saml";
export type SamlMode = "off" | "optional" | "required" | "members_only";
export type RoleBaseLevel = "admin" | "member" | "guest";

/**
 * The legacy is_admin / is_guest flags mirror the assigned workspace role.
 * When a role is present its base level is authoritative; accounts without a
 * role keep their flags so pre-RBAC data stays usable.
 */
export function resolveRoleFlags(
  baseLevel: RoleBaseLevel | string | null | undefined,
  flags: { isAdmin: boolean; isGuest: boolean },
): { isAdmin: boolean; isGuest: boolean } {
  if (baseLevel === "admin") return { isAdmin: true, isGuest: false };
  if (baseLevel === "guest") return { isAdmin: false, isGuest: true };
  if (baseLevel === "member") return { isAdmin: false, isGuest: false };
  return { isAdmin: flags.isAdmin, isGuest: flags.isGuest };
}

/** Administrators retain the existing emergency password sign-in exception. */
export function isSamlSessionAllowed(
  mode: SamlMode,
  user: { isAdmin: boolean; isGuest: boolean; baseLevel?: RoleBaseLevel | string | null },
  method: SessionAuthMethod,
): boolean {
  const { isAdmin, isGuest } = resolveRoleFlags(user.baseLevel, user);
  return method === "saml" || isAdmin || mode === "off" || mode === "optional"
    || (mode === "members_only" && isGuest);
}

/** An internal session insert was refused after a concurrent SAML policy change. */
export class SamlSessionRequiredError extends Error {
  constructor() {
    super("SAML SSO is required for this workspace");
    this.name = "SamlSessionRequiredError";
  }
}
