-- 044: Rep bonus can be SPLIT between setter and closer.
-- bonus_recipient (025) gains a third value, 'split'. When set, bonus_split_pct
-- is the SETTER'S share of the total bonus as a fraction (0.5 = 50/50); null
-- with 'split' means 50/50. Mirrors deduction_paid_by='split' +
-- deduction_split_pct (012) exactly, so the two splits behave the same way.
-- On a solo deal (no distinct closer) the engine ignores the split and pays
-- the whole bonus to the setter, same as it already does for 'closer'.
-- Idempotent: safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS bonus_split_pct NUMERIC(5,4);  -- setter's share of the bonus, 0..1
