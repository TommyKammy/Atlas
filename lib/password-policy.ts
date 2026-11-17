import { db, type Queryable } from "./db";

export type PasswordPolicy = {
  min_length: number;
  require_upper: boolean;
  require_lower: boolean;
  require_number: boolean;
  require_symbol: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_length: 8,
  require_upper: false,
  require_lower: false,
  require_number: false,
  require_symbol: false,
};

type PolicyRow = {
  password_min_length: number;
  password_require_upper: boolean;
  password_require_lower: boolean;
  password_require_number: boolean;
  password_require_symbol: boolean;
};

export async function getPasswordPolicy(q: Queryable = db): Promise<PasswordPolicy> {
  const r = await q.query(
    `SELECT password_min_length, password_require_upper, password_require_lower,
       password_require_number, password_require_symbol
     FROM workspace_security ORDER BY workspace_id LIMIT 1`,
  );
  const row = r.rows[0] as PolicyRow | undefined;
  if (!row) return DEFAULT_PASSWORD_POLICY;
  return {
    min_length: Number(row.password_min_length) || 8,
    require_upper: row.password_require_upper === true,
    require_lower: row.password_require_lower === true,
    require_number: row.password_require_number === true,
    require_symbol: row.password_require_symbol === true,
  };
}

export function passwordPolicyError(password: string, policy: PasswordPolicy): string | null {
  const length = Array.from(password).length;
  if (length < policy.min_length) {
    return `password must be at least ${policy.min_length} characters`;
  }
  if (length > 200) return "password must be at most 200 characters";
  if (policy.require_upper && !/[A-Z]/.test(password)) {
    return "password must contain an uppercase letter";
  }
  if (policy.require_lower && !/[a-z]/.test(password)) {
    return "password must contain a lowercase letter";
  }
  if (policy.require_number && !/[0-9]/.test(password)) {
    return "password must contain a number";
  }
  if (policy.require_symbol && !/[^A-Za-z0-9]/.test(password)) {
    return "password must contain a symbol";
  }
  return null;
}

/** Validate against the workspace policy and return a user-facing error. */
export async function validatePassword(password: string, q: Queryable = db): Promise<string | null> {
  return passwordPolicyError(password, await getPasswordPolicy(q));
}

export function passwordPolicySummary(policy: PasswordPolicy): string {
  const parts = [`${policy.min_length}文字以上`];
  if (policy.require_upper) parts.push("大文字");
  if (policy.require_lower) parts.push("小文字");
  if (policy.require_number) parts.push("数字");
  if (policy.require_symbol) parts.push("記号");
  return parts.length === 1 ? parts[0] : `${parts[0]}（${parts.slice(1).join("・")}を含む）`;
}
