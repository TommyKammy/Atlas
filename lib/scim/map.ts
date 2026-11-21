import { invalidValue, SCIM_USER_SCHEMA } from "./errors";
import {
  emailFromEmails, emptyScimNameState, mergeScimName, normalizeScimEmail, parseScimBoolean,
  type ScimNamePatch,
} from "./patch";

export type ScimUserRow = {
  id: number;
  name: string;
  email: string | null;
  title: string;
  deactivated_at: Date | string | null;
  created_at: Date | string;
  external_id?: string | null;
  identity_user_name?: string | null;
  identity_given_name?: string | null;
  identity_family_name?: string | null;
  identity_formatted_name?: string | null;
  identity_display_name?: string | null;
  identity_updated_at?: Date | string | null;
};

export type ScimListRow = ScimUserRow & { total: number };

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function nameObject(body: Record<string, unknown>): Record<string, unknown> | null {
  const name = body.name;
  return name && typeof name === "object" && !Array.isArray(name) ? name as Record<string, unknown> : null;
}

/** Extract received name parts without collapsing them; absent keys stay absent.
 * PUT passes replace=true so an omitted part of the name object is cleared. */
export function scimNamePatchFromPayload(
  body: Record<string, unknown>,
  replace = false,
): ScimNamePatch {
  const name = nameObject(body);
  const hasName = typeof body.name === "string" || name !== null
    || typeof body.displayName === "string";
  if (!hasName) return {};
  const patch: ScimNamePatch = replace
    ? { formatted: null, givenName: null, familyName: null, displayName: null }
    : {};
  if (typeof body.name === "string") patch.formatted = body.name;
  for (const [source, target] of [
    ["formatted", "formatted"], ["givenName", "givenName"], ["familyName", "familyName"],
  ] as const) {
    const value = name?.[source];
    if (typeof value === "string") patch[target] = value;
  }
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  return patch;
}

export function hasScimNameInput(body: Record<string, unknown>): boolean {
  return Object.keys(scimNamePatchFromPayload(body)).length > 0;
}

export function scimNameFromPayload(body: Record<string, unknown>, email: string): string {
  return mergeScimName(emptyScimNameState(), scimNamePatchFromPayload(body), email).name;
}

/** SCIM userName, preserved verbatim (often a UPN rather than an email). */
export function scimUserNameFromPayload(body: Record<string, unknown>): string | undefined {
  return stringValue(body.userName);
}

/**
 * Atlas email comes from emails when the attribute is present; only a request
 * without emails may fall back to userName. A UPN in userName is not silently
 * written into users.email.
 */
export function scimEmailFromPayload(body: Record<string, unknown>): string {
  if (body.emails !== undefined) {
    const fromEmails = emailFromEmails(body.emails);
    if (!fromEmails) throw invalidValue("emails must contain a usable email address");
    return normalizeScimEmail(fromEmails);
  }
  const candidate = stringValue(body.userName);
  if (!candidate) throw invalidValue("emails or userName is required");
  return normalizeScimEmail(candidate);
}

/** Whether users.email was derived from the bound SCIM userName and may follow it. */
export function userNameDrivesEmail(currentEmail: string | null, oldUserName: string | null): boolean {
  if (!currentEmail || !oldUserName) return false;
  return currentEmail.toLowerCase() === oldUserName.toLowerCase();
}

/** SCIM's default for active is true. */
export function scimActiveFromPayload(body: Record<string, unknown>): boolean {
  if (!("active" in body)) return true;
  const parsed = parseScimBoolean(body.active);
  if (parsed === undefined) throw invalidValue("active must be a boolean");
  return parsed;
}

export function scimTitleFromPayload(body: Record<string, unknown>): string | undefined {
  return typeof body.title === "string" ? body.title.trim().slice(0, 120) : undefined;
}

/** undefined means the key was absent; null means the key explicitly cleared it. */
export function scimExternalIdFromPayload(body: Record<string, unknown>): string | null | undefined {
  if (!("externalId" in body)) return undefined;
  if (body.externalId === null) return null;
  if (typeof body.externalId !== "string") return undefined;
  const value = body.externalId.trim();
  return value === "" ? null : value;
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function scimUserResource(row: ScimUserRow, origin: string) {
  const externalId = row.external_id ?? undefined;
  const name: Record<string, string> = {
    formatted: row.identity_formatted_name ?? row.name,
  };
  if (row.identity_given_name != null) name.givenName = row.identity_given_name;
  if (row.identity_family_name != null) name.familyName = row.identity_family_name;
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: String(row.id),
    ...(externalId === undefined ? {} : { externalId }),
    userName: row.identity_user_name ?? row.email ?? "",
    name,
    displayName: row.name,
    emails: [{ value: row.email ?? "", type: "work", primary: true }],
    title: row.title,
    active: row.deactivated_at === null,
    meta: {
      resourceType: "User",
      created: iso(row.created_at),
      lastModified: iso(row.identity_updated_at ?? row.created_at),
      location: `${origin}/scim/v2/Users/${row.id}`,
    },
  };
}

export function scimListResponse(resources: unknown[], startIndex: number, totalResults: number) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}
