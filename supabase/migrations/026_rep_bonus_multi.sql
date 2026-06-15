-- 026: Multi-source rep bonus. Several management roles (and/or the company)
-- can each chip in toward a rep bonus on a deal. Each value is the resolved
-- DOLLAR contribution (the editor lets you type a % of baseline or a $, and
-- stores the $). Each management contribution is pulled from that role's
-- override (capped at what they have); 'company' is an extra on top. The rep
-- (bonus_recipient: setter|closer, added 025) receives the sum.
-- Supersedes the single-source columns from 025 (bonus_amount / bonus_pct /
-- bonus_source), which are left in place but no longer used.
-- Idempotent: safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_company  NUMERIC(12,2);  -- extra, from nobody's override
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_manager  NUMERIC(12,2);  -- pulled from manager override
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_director NUMERIC(12,2);  -- pulled from director override
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_vp       NUMERIC(12,2);  -- pulled from vp override
