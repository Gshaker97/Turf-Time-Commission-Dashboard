-- ============================================================
-- 015_competition_goals.sql — competition goal + credit parameters
-- ------------------------------------------------------------
-- Adds:
--   goal_mode        'race' (highest score wins, default) | 'target'
--   goal_target      NUMERIC — the number to reach when goal_mode='target'
--                    (dollars of baseline for revenue, count for deals).
--                    Drives the per-entrant progress bar + "earned" state.
--   credit_mode      how a deal's metric is attributed when setter ≠ closer:
--                    'both' (each gets full credit, default), 'self_gen'
--                    (only solo deals), 'setter', 'closer', or 'split'.
--   credit_split_pct the closer's share when credit_mode='split' (fraction,
--                    default 0.5; the setter gets the remainder).
--
-- Idempotent. Standings are still computed on the frontend.
-- ============================================================

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS goal_mode        TEXT NOT NULL DEFAULT 'race';
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS goal_target      NUMERIC;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS credit_mode      TEXT NOT NULL DEFAULT 'both';
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS credit_split_pct NUMERIC DEFAULT 0.5;
