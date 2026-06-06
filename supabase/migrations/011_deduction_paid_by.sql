-- ============================================================
-- 011_deduction_paid_by.sql — who absorbs a deal's deduction
-- ------------------------------------------------------------
-- Adds deals.deduction_paid_by (text): on a split deal (setter ≠ closer),
-- chooses who the deduction (incl. dealer fee) comes out of:
--   'closer' (default / legacy behavior) | 'setter' | 'split' (50/50)
-- Ignored on solo deals (always the setter — the only rep). Idempotent.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS deduction_paid_by TEXT;
