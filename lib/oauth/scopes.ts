export type OAuthScope = "read" | "write";

const ORDERED_SCOPES: OAuthScope[] = ["read", "write"];

/**
 * Normalize a requested scope list to the two scopes Atlas understands.
 * `read` is mandatory (write implies read) and unknown values fail closed.
 */
export function normalizeOAuthScopes(value: unknown): OAuthScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((scope) => scope === "read" || scope === "write")) return null;
  if (!value.includes("read")) return null;
  return ORDERED_SCOPES.filter((scope) => value.includes(scope));
}

/** Parse a space-delimited RFC 6749 scope parameter. Empty means no scope. */
export function parseScopeParameter(value: string | null): string[] {
  if (!value) return [];
  return value.split(" ").filter((scope) => scope !== "");
}
