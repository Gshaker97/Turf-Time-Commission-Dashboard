-- 023: Track the sheet's last-synced financials per deal, so the sync can tell
-- a REAL change order (the sheet now shows new numbers) apart from a manual
-- in-app edit (you changed the deal; the sheet didn't). A change order then
-- fires + un-gold-checks for review; a manual edit (or a duplicate sheet row
-- with the same numbers) is left alone.
-- Idempotent: safe to run more than once.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS synced_baseline  NUMERIC(12,2);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS synced_job_price NUMERIC(12,2);
