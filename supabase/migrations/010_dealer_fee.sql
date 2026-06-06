-- ============================================================
-- 010_dealer_fee.sql — financing dealer fee
-- ------------------------------------------------------------
-- Adds:
--   • deals.financed_amount (numeric) — the amount financed on the deal.
--   • deals.dealer_fee_pct  (numeric) — dealer fee rate, stored as a FRACTION
--     (0.05 = 5%), matching the override_pct columns.
--
-- The dealer fee = financed_amount * dealer_fee_pct is treated as a deduction
-- (added to deduction_amount) in the commission engine, so it reduces the
-- rep's take like any other deduction. Idempotent.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS financed_amount NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS dealer_fee_pct  NUMERIC;
