/**
 * SCIM-managed accounts get their profile from the IdP. Administrators may
 * still deactivate them immediately and change role, password, avatar or 2FA,
 * but cannot rename an active binding or reactivate a deleted/active binding
 * while SCIM is enabled.
 */
export const SCIM_PROFILE_LOCK_MESSAGE =
  "このユーザーは SCIM（IdP）で管理されています。名前・メールアドレス・役職は IdP で変更してください。";

export const SCIM_REACTIVATE_MESSAGE =
  "SCIM で管理されているユーザーは管理画面から有効化できません。IdP で割り当てを戻すか、IdP 側で有効にしてください。";

export const SCIM_DELETED_REACTIVATE_MESSAGE =
  "SCIM（IdP）で削除・割り当て解除されたユーザーです。IdP で割り当て直してください。";

export type ScimUserState = "active" | "deleted" | "disabled" | null;

export type ScimManagedProfile = {
  scimEnabled: boolean;
  scimManaged: boolean;
  scimDeleted: boolean;
  deactivated: boolean;
  name: string;
  email: string | null;
  title: string;
};

export type ScimProfileChange = {
  name?: unknown;
  email?: unknown;
  title?: unknown;
  deactivated?: unknown;
};

/** Classify the badge/protection state from the admin user row fields. */
export function scimUserState(input: {
  scim_managed?: boolean | null;
  scim_deleted?: boolean | null;
  scim_enabled?: boolean | null;
}): ScimUserState {
  if (input.scim_managed !== true) return null;
  if (input.scim_enabled !== true) return "disabled";
  return input.scim_deleted === true ? "deleted" : "active";
}

/** Return a user-facing rejection, or null when the change is allowed. */
export function scimManagedChangeError(
  target: ScimManagedProfile,
  change: ScimProfileChange,
): string | null {
  // Turning SCIM off releases every protection so the workspace can manage
  // its accounts directly again.
  if (!target.scimEnabled || !target.scimManaged) return null;
  // Profile fields are protected only while the IdP binding is active.
  if (!target.scimDeleted) {
    if (typeof change.name === "string" && change.name.trim() !== ""
        && change.name.trim() !== target.name) {
      return SCIM_PROFILE_LOCK_MESSAGE;
    }
    if (typeof change.email === "string" && change.email.trim() !== ""
        && change.email.trim().toLowerCase() !== (target.email ?? "").toLowerCase()) {
      return SCIM_PROFILE_LOCK_MESSAGE;
    }
    if (typeof change.title === "string" && change.title.trim() !== target.title) {
      return SCIM_PROFILE_LOCK_MESSAGE;
    }
  }
  if (change.deactivated === false && target.deactivated) {
    return target.scimDeleted ? SCIM_DELETED_REACTIVATE_MESSAGE : SCIM_REACTIVATE_MESSAGE;
  }
  return null;
}
