import { invalidSyntax, invalidValue } from "./errors";

export type ScimPatchOperation = { op?: unknown; path?: unknown; value?: unknown };

export type ScimPatchFields = {
  userName?: string;
  email?: string;
  name?: ScimNamePatch;
  title?: string;
  externalId?: string | null;
  active?: boolean;
};

export type ScimNameState = {
  formatted: string | null;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
};

export type ScimNamePatch = Partial<ScimNameState>;

const EMPTY_NAME: ScimNameState = {
  formatted: null, givenName: null, familyName: null, displayName: null,
};

export function emptyScimNameState(): ScimNameState {
  return { ...EMPTY_NAME };
}

function cleanName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, 120);
}

/** Merge stored name parts with a partial change and choose the Atlas display name. */
export function mergeScimName(
  current: ScimNameState,
  patch: ScimNamePatch,
  email: string,
): { state: ScimNameState; name: string } {
  const state: ScimNameState = {
    formatted: cleanName(patch.formatted !== undefined ? patch.formatted : current.formatted),
    givenName: cleanName(patch.givenName !== undefined ? patch.givenName : current.givenName),
    familyName: cleanName(patch.familyName !== undefined ? patch.familyName : current.familyName),
    displayName: cleanName(patch.displayName !== undefined ? patch.displayName : current.displayName),
  };
  const combined = [state.givenName, state.familyName].filter(Boolean).join(" ").trim();
  const name = (state.formatted || state.displayName || combined
    || email.split("@")[0] || "SCIM user").slice(0, 120);
  return { state, name };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PATH = /^name\.(givenname|familyname|formatted)$/i;
const WORK_EMAIL_PATH = /^emails\s*\[\s*type\s+eq\s+"work"\s*\]\s*\.value$/i;

export function isScimEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function normalizeScimEmail(value: string): string {
  const email = value.trim().toLowerCase().slice(0, 255);
  if (!EMAIL.test(email)) throw invalidValue(`invalid email address: ${value}`);
  return email;
}

/** SCIM booleans are booleans, but Entra sends the strings "True"/"False". */
export function parseScimBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^true$/i.test(value.trim())) return true;
    if (/^false$/i.test(value.trim())) return false;
  }
  return undefined;
}

type EmailValue = { value: string; type?: string; primary?: boolean };

function emailValue(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;
  const value = (input as { value?: unknown }).value;
  return typeof value === "string" ? value : null;
}

/** Primary wins, then type "work", then the first usable value. */
export function emailFromEmails(input: unknown): string | null {
  const list = Array.isArray(input) ? input : [input];
  const values: EmailValue[] = [];
  for (const item of list) {
    const value = emailValue(item);
    if (value === null) continue;
    if (item && typeof item === "object") {
      const record = item as { type?: unknown; primary?: unknown };
      values.push({
        value,
        type: typeof record.type === "string" ? record.type : undefined,
        primary: record.primary === true,
      });
    } else {
      values.push({ value });
    }
  }
  return values.find((item) => item.primary)?.value
    ?? values.find((item) => item.type?.toLowerCase() === "work")?.value
    ?? values[0]?.value
    ?? null;
}

type Draft = {
  emailFromEmails?: string;
  userName?: string;
  displayName?: string | null;
  formatted?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  title?: string;
  externalId?: string | null;
  active?: boolean;
};

function setEmail(draft: Draft, input: unknown) {
  const email = emailFromEmails(input);
  if (email !== null) draft.emailFromEmails = email;
}

function setNameObject(draft: Draft, input: unknown) {
  if (!input || typeof input !== "object") return;
  const record = input as Record<string, unknown>;
  if (typeof record.formatted === "string") draft.formatted = record.formatted;
  if (typeof record.givenName === "string") draft.givenName = record.givenName;
  if (typeof record.familyName === "string") draft.familyName = record.familyName;
}

function removeNamePart(draft: Draft, part: string) {
  if (part.toLowerCase() === "formatted") draft.formatted = null;
  else if (part.toLowerCase() === "givenname") draft.givenName = null;
  else draft.familyName = null;
}

function applyKnownKey(draft: Draft, key: string, value: unknown, remove: boolean) {
  const normalized = key.toLowerCase();
  if (normalized === "active") {
    if (remove) draft.active = true;
    else {
      const parsed = parseScimBoolean(value);
      if (parsed === undefined) throw invalidValue("active must be a boolean");
      draft.active = parsed;
    }
    return;
  }
  if (normalized === "username") {
    if (remove) return;
    if (typeof value !== "string" || value.trim() === "") throw invalidValue("userName must be a non-empty string");
    draft.userName = value;
    return;
  }
  if (normalized === "displayname") {
    if (remove) draft.displayName = null;
    else if (typeof value === "string") draft.displayName = value;
    return;
  }
  if (normalized === "title") {
    if (remove) draft.title = "";
    else if (typeof value === "string") draft.title = value;
    return;
  }
  if (normalized === "externalid") {
    if (remove || value === null) draft.externalId = null;
    else if (typeof value === "string") draft.externalId = value.trim() === "" ? null : value;
    return;
  }
  if (normalized === "name") {
    if (remove) {
      draft.formatted = null;
      draft.givenName = null;
      draft.familyName = null;
    } else {
      if (typeof value === "string") draft.formatted = value;
      else setNameObject(draft, value);
    }
    return;
  }
  if (normalized === "emails") {
    if (!remove) setEmail(draft, value);
    return;
  }
  const namePart = NAME_PATH.exec(key);
  if (namePart) {
    if (remove) removeNamePart(draft, namePart[1]);
    else if (typeof value === "string") {
      const part = namePart[1].toLowerCase();
      if (part === "formatted") draft.formatted = value;
      else if (part === "givenname") draft.givenName = value;
      else draft.familyName = value;
    }
    return;
  }
  if (normalized === "emails.value" || WORK_EMAIL_PATH.test(key)) {
    if (remove) return;
    const email = emailValue(value);
    if (email !== null) draft.emailFromEmails = email;
    return;
  }
  // Unsupported attributes (including enterprise extensions) are ignored.
}

function applyValueObject(draft: Draft, value: Record<string, unknown>) {
  for (const [key, item] of Object.entries(value)) applyKnownKey(draft, key, item, false);
}

/**
 * Apply SCIM PATCH operations for the supported User attributes. Unknown
 * attributes are deliberately ignored so Entra's enterprise payload succeeds.
 */
export function applyScimPatch(operations: ScimPatchOperation[]): ScimPatchFields {
  const draft: Draft = {};
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw invalidSyntax("operation must be an object");
    if (typeof operation.op !== "string" || !/^(add|replace|remove)$/i.test(operation.op)) {
      throw invalidSyntax("op must be add, replace or remove");
    }
    const remove = operation.op.toLowerCase() === "remove";
    if (typeof operation.path === "string" && operation.path.trim() !== "") {
      applyKnownKey(draft, operation.path.trim(), operation.value, remove);
    } else if (!remove && operation.value && typeof operation.value === "object" && !Array.isArray(operation.value)) {
      applyValueObject(draft, operation.value as Record<string, unknown>);
    }
    // A path-less remove has no target and is ignored.
  }

  const fields: ScimPatchFields = {};
  if (draft.userName !== undefined) fields.userName = draft.userName.trim();
  if (draft.emailFromEmails !== undefined) fields.email = normalizeScimEmail(draft.emailFromEmails);
  const name: ScimNamePatch = {};
  if (draft.formatted !== undefined) name.formatted = draft.formatted;
  if (draft.givenName !== undefined) name.givenName = draft.givenName;
  if (draft.familyName !== undefined) name.familyName = draft.familyName;
  if (draft.displayName !== undefined) name.displayName = draft.displayName;
  if (Object.keys(name).length > 0) fields.name = name;
  if (draft.title !== undefined) fields.title = draft.title.trim().slice(0, 120);
  if (draft.externalId !== undefined) fields.externalId = draft.externalId;
  if (draft.active !== undefined) fields.active = draft.active;
  return fields;
}
