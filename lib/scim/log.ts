export const SCIM_FILTER_MAX_LENGTH = 200;
export const SCIM_DETAIL_MAX_LENGTH = 300;
export const SCIM_PATH_MAX_LENGTH = 500;

const IDP_LABELS: Record<string, string> = {
  entra: "Entra ID",
  okta: "Okta",
  generic: "汎用",
};

export function scimIdpLabel(idp: string | null | undefined): string {
  if (!idp) return "–";
  return IDP_LABELS[idp] ?? idp;
}

/** Keep only the path. Query strings can contain filters and other values. */
export function scimPathOnly(value: string): string {
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return value.split("?")[0] ?? value;
  }
}

export function scimFilterFromUrl(value: string): string | null {
  try {
    return new URL(value, "http://localhost").searchParams.get("filter");
  } catch {
    return null;
  }
}

/** User id from /Users/{id}; the id is an Atlas users.id string. */
export function scimTargetUserId(value: string): number | null {
  const match = /\/Users\/(\d+)\/?$/.exec(scimPathOnly(value));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** User id from the Location header returned by POST /Users. */
export function scimCreatedUserId(location: string | null | undefined): number | null {
  if (!location) return null;
  return scimTargetUserId(location);
}

/**
 * Human-readable operation for the admin sync log. SCIM DELETE deactivates the
 * Atlas account instead of deleting it, so it is labelled accordingly.
 */
export function scimOperationLabel(
  method: string,
  path: string,
  filter?: string | null,
): string {
  const verb = method.toUpperCase();
  const cleanPath = scimPathOnly(path).replace(/\/+$/, "");
  if (/\/Users\/[^/]+$/.test(cleanPath)) {
    if (verb === "GET") return "ユーザー取得";
    if (verb === "PUT" || verb === "PATCH") return "ユーザー更新";
    if (verb === "DELETE") return "ユーザー無効化";
  }
  if (/\/Users$/.test(cleanPath)) {
    if (verb === "GET") return filter ? "ユーザー検索" : "ユーザー一覧";
    if (verb === "POST") return "ユーザー作成";
  }
  if (cleanPath.endsWith("/ServiceProviderConfig") && verb === "GET") return "対応機能の確認";
  if (cleanPath.endsWith("/ResourceTypes") && verb === "GET") return "リソース種別の確認";
  if (cleanPath.endsWith("/Schemas") && verb === "GET") return "スキーマの確認";
  return verb === "GET" ? "SCIM 要求" : `${verb} 要求`;
}

/** Remove values that look like bearer tokens before persisting a detail. */
export function redactScimSecrets(value: string): string {
  // Redact the whole Authorization value first, including an atlas token after
  // "Bearer ". A short phrase such as "invalid or expired bearer token" must
  // stay readable, so only 20+ token-like characters count.
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [redacted]")
    .replace(/atlas_scim_[A-Za-z0-9_-]+/g, "atlas_scim_[redacted]");
}

/** 429 is already the rate-limit ceiling; recording it would defeat the limit. */
export function shouldRecordScimRequest(status: number): boolean {
  return status !== 429;
}

/** Run a log write without letting its failure escape into the SCIM response. */
export async function runScimLogWrite(
  write: () => Promise<void>,
  onError: (error: unknown) => void = () => undefined,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    onError(error);
  }
}

export function trimScimText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, maxLength);
}

export type ScimLogInput = {
  method: string;
  path: string;
  filter?: string | null;
  status: number;
  scimType?: string | null;
  detail?: string | null;
  userId?: number | null;
};

export type ScimLogRecord = {
  method: string;
  path: string;
  filter: string | null;
  status: number;
  scim_type: string | null;
  detail: string | null;
  user_id: number | null;
};

/**
 * Build the exact DB payload. Callers pass only request metadata; bodies,
 * headers and the Authorization value are never part of the record.
 */
export function scimLogRecord(input: ScimLogInput): ScimLogRecord {
  const userId = typeof input.userId === "number"
    && Number.isSafeInteger(input.userId) && input.userId > 0
    ? input.userId
    : null;
  return {
    method: input.method.toUpperCase().slice(0, 16),
    path: scimPathOnly(input.path).slice(0, SCIM_PATH_MAX_LENGTH),
    filter: trimScimText(
      input.filter ? redactScimSecrets(input.filter) : input.filter,
      SCIM_FILTER_MAX_LENGTH,
    ),
    status: Number.isInteger(input.status) ? input.status : 0,
    scim_type: trimScimText(input.scimType, 64),
    detail: input.detail
      ? trimScimText(redactScimSecrets(input.detail), SCIM_DETAIL_MAX_LENGTH)
      : null,
    user_id: userId,
  };
}
