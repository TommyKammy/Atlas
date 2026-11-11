-- scripts/migrate.ts encrypts legacy values in the same transaction before this
-- constraint is installed. No encryption key is stored in PostgreSQL or SQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_totp_secret_encrypted') THEN
    ALTER TABLE users ADD CONSTRAINT users_totp_secret_encrypted CHECK (
      totp_secret IS NULL OR totp_secret ~ '^atlas-mfa:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,171}:[A-Za-z0-9_-]{22}$'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_totp_pending_secret_encrypted') THEN
    ALTER TABLE users ADD CONSTRAINT users_totp_pending_secret_encrypted CHECK (
      totp_pending_secret IS NULL OR totp_pending_secret ~ '^atlas-mfa:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,171}:[A-Za-z0-9_-]{22}$'
    );
  END IF;
END;
$$;
