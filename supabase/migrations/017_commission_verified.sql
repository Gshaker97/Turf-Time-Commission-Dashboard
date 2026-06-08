-- ============================================================
-- 017_commission_verified.sql — commission sign-off
-- ------------------------------------------------------------
-- Adds deals.commission_verified (boolean). A leadership "I checked this deal's
-- commission and it looks good" flag, toggled from the Commission column on the
-- Deals page (VP/admin). Purely informational. Idempotent.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS commission_verified BOOLEAN NOT NULL DEFAULT FALSE;
