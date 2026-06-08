-- ============================================================
-- 018_weekly_stats_split.sql — split weekly estimates into self-gen vs leads
-- ------------------------------------------------------------
-- The Weekly Stats tab now tracks estimates separately for self-generated leads
-- and for handed/company leads, each with its own close rate (closes are still
-- derived on the frontend from deals: self-gen close = rep set AND closed it;
-- lead close = rep closed a deal someone else set).
--
-- Adds self_gen_estimates + lead_estimates. The old single `estimates` column
-- is kept (written as the sum) for back-compat; existing values are migrated
-- into self_gen_estimates so historical numbers aren't lost. Idempotent.
-- ============================================================

ALTER TABLE weekly_stats ADD COLUMN IF NOT EXISTS self_gen_estimates INT NOT NULL DEFAULT 0 CHECK (self_gen_estimates >= 0);
ALTER TABLE weekly_stats ADD COLUMN IF NOT EXISTS lead_estimates     INT NOT NULL DEFAULT 0 CHECK (lead_estimates >= 0);

-- One-time: carry existing totals into the self-gen bucket (best guess) so old
-- weeks keep their numbers. Only touches rows not already split.
UPDATE weekly_stats
SET self_gen_estimates = estimates
WHERE self_gen_estimates = 0 AND lead_estimates = 0 AND estimates > 0;
