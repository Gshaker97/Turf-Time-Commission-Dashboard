-- 025: Optional per-deal rep bonus. A flat dollar amount OR a percent of
-- baseline, paid to the setter (default) or closer. It can be funded from a
-- management override (manager / director / vp) — that role's payout is reduced
-- by what's pulled — or 'company' (an extra on top, reduced from nobody).
-- All commission math lives in src/utils/commission.js; these just store the
-- inputs. Idempotent: safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_amount    NUMERIC(12,2);  -- flat $ (null when using %)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_pct       NUMERIC;        -- fraction of baseline (null when using $)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_source    TEXT;           -- 'company' | 'manager' | 'director' | 'vp'
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_recipient TEXT;           -- 'setter' | 'closer'
