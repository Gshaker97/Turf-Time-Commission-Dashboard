-- ============================================================
-- 008_checklist.sql — per-deal "new deal" review checklist
--
-- Adds deals.checklist (jsonb): an array of the checked item keys for the
-- inline new-deal checklist on the Deals page, e.g.
--   ["contract_signed","payment_method","scheduled"]
--
-- Idempotent. VPs/managers/directors/admins can write it through the existing
-- deals_update policy (same path as the other inline edits).
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS checklist JSONB;
