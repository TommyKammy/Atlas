-- Link a portfolio initiative's free-text owner to an Atlas member without
-- rewriting any historical text. Existing rows keep owner_member_id NULL and
-- their exact owner_name; no name matching or backfill is attempted.
--
-- The human-readable owner_name is deliberately denormalized and kept when an
-- account is deactivated or deleted, so adopted decisions and old ledger rows
-- continue to show the name that was stored with them. This column never
-- participates in access checks.
ALTER TABLE portfolio_initiatives
  ADD COLUMN owner_member_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_portfolio_initiatives_owner_member
  ON portfolio_initiatives(owner_member_id)
  WHERE owner_member_id IS NOT NULL;
