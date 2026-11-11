import type { Queryable } from "./db";
import { activeMfaKeyId, decryptMfaSecret, encryptMfaSecret, isEncryptedMfaSecret, mfaSecretKeyId, MfaSecretUnavailableError } from "./mfa-secret";

/** Caller owns a transaction. The table lock prevents concurrent plaintext writes. */
export async function migrateLegacyMfaSecrets(q: Queryable): Promise<number> {
  return rewriteMfaSecrets(q, true);
}

/** Caller owns a transaction and retains old keys until this operation commits. */
export async function rotateMfaSecrets(q: Queryable): Promise<number> {
  return rewriteMfaSecrets(q, false);
}

async function rewriteMfaSecrets(q: Queryable, allowPlaintext: boolean): Promise<number> {
  // Match session issuance and classification changes: policy before users.
  await q.query(`SELECT workspace_id FROM workspace_security
    WHERE workspace_id=(SELECT id FROM workspaces ORDER BY id LIMIT 1) FOR SHARE`);
  // Also block SELECT FOR UPDATE before taking row locks. A weaker table mode
  // can deadlock with a verifier holding a user row before its later UPDATE.
  await q.query("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
  const result = await q.query(
    "SELECT id, totp_secret, totp_pending_secret FROM users WHERE totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL ORDER BY id FOR UPDATE",
  );
  if (result.rows.length === 0) return 0;
  const activeId = activeMfaKeyId();
  let changed = 0;
  for (const row of result.rows as { id: string; totp_secret: string | null; totp_pending_secret: string | null }[]) {
    const rewrite = (value: string | null, purpose: "active" | "pending") => {
      if (value === null) return null;
      if (isEncryptedMfaSecret(value)) {
        const plaintext = decryptMfaSecret(value, row.id, purpose);
        return mfaSecretKeyId(value) === activeId ? value : encryptMfaSecret(plaintext, row.id, purpose);
      }
      if (!allowPlaintext) throw new MfaSecretUnavailableError("invalid_secret");
      return encryptMfaSecret(value, row.id, purpose);
    };
    const active = rewrite(row.totp_secret, "active");
    const pending = rewrite(row.totp_pending_secret, "pending");
    if (active !== row.totp_secret || pending !== row.totp_pending_secret) {
      await q.query("UPDATE users SET totp_secret=$2, totp_pending_secret=$3 WHERE id=$1", [row.id, active, pending]);
      changed++;
    }
  }
  return changed;
}
