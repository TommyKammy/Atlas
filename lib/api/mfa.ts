import type { Queryable } from "@/lib/db";
import { hashRecoveryCode } from "@/lib/totp";

export async function consumeRecoveryCodeForUser(q: Queryable, userId: number, code: string): Promise<boolean> {
  const result = await q.query(
    `UPDATE users SET totp_recovery_codes = array_remove(totp_recovery_codes, $2::text)
     WHERE id = $1 AND deactivated_at IS NULL AND totp_enabled
       AND $2::text = ANY(totp_recovery_codes)`,
    [userId, hashRecoveryCode(code)],
  );
  return result.rowCount === 1;
}
