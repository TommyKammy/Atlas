/**
 * Pure helpers for development-project issue keys such as ATL-123
 * (docs/dev-projects-phase0.md §3, §5). Database work lives in
 * lib/services/dev-projects.ts and db/migrations/0041_dev_project_keys.sql.
 */

/** Stored prefixes: an uppercase letter followed by 1–9 uppercase letters or digits. */
export const DEV_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

const TASK_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$/;

/** Upper-case and validate a prefix typed by a person; null when it is not usable. */
export function normalizeDevPrefix(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const prefix = input.trim().toUpperCase();
  return DEV_PREFIX_PATTERN.test(prefix) ? prefix : null;
}

/** Parse "ATL-123" (any letter case). Returns null for anything else. */
export function parseTaskKey(input: unknown): { prefix: string; number: number } | null {
  if (typeof input !== "string") return null;
  const match = TASK_KEY_PATTERN.exec(input.trim());
  if (!match) return null;
  return { prefix: match[1].toUpperCase(), number: Number(match[2]) };
}

/** Display key from the namespace's current prefix and the task's number. */
export function formatTaskKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

/**
 * Branch name for a task. branchPrefix is fixed when the project is enabled,
 * so the name survives prefix renames (§6.2).
 */
export function taskBranchName(branchPrefix: string, number: number): string {
  return `${branchPrefix}-${number}`;
}
