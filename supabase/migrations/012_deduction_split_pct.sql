-- ============================================================
-- 012_deduction_split_pct.sql — custom deduction split ratio
-- ------------------------------------------------------------
-- Adds deals.deduction_split_pct (numeric, FRACTION = the SETTER's share of
-- the deduction) used when deduction_paid_by = 'split'. Null/absent → 0.5
-- (even 50/50). Idempotent.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS deduction_split_pct NUMERIC;
