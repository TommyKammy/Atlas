import { invalidFilter } from "./errors";

export type ScimUserFilterField = "userName" | "externalId" | "id" | "email";

export type ScimUserFilter = { field: ScimUserFilterField; value: string };

const FILTER = /^\s*(userName|externalId|id|emails\.value|emails\s*\[\s*type\s+eq\s+"work"\s*\]\s*\.value)\s+([A-Za-z]+)\s+"((?:[^"\\]|\\.)*)"\s*$/i;

function unquote(value: string): string {
  return value.replace(/\\(["\\/])/g, "$1");
}

/**
 * Parse the subset of SCIM filters Atlas supports for /Users. Attribute names
 * and operators are case-insensitive; only `eq` with a quoted string is allowed.
 */
export function parseUserFilter(raw: string | null | undefined): ScimUserFilter | null {
  if (raw === null || raw === undefined) return null;
  if (raw.trim() === "") throw invalidFilter("filter must not be empty");
  const match = FILTER.exec(raw);
  if (!match) throw invalidFilter(`unsupported filter: ${raw}`);
  const [, attribute, operator, value] = match;
  if (operator.toLowerCase() !== "eq") throw invalidFilter(`unsupported operator: ${operator}`);
  const normalized = attribute.toLowerCase();
  let field: ScimUserFilterField;
  if (normalized === "username") field = "userName";
  else if (normalized === "externalid") field = "externalId";
  else if (normalized === "id") field = "id";
  else field = "email";
  return { field, value: unquote(value) };
}
