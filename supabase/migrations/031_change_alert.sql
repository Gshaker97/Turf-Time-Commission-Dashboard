-- 031: Change ALERTS replace automatic change orders. When the sheet shows new
-- financials for a deal that already exists (a re-signed agreement), the sync
-- no longer rewrites the deal (numbers/status/gold check all stay put) — it
-- stamps deals.change_alert with the old → new figures instead, so the deal
-- wears a clearable ❗ flag on the Deals page until an admin reviews it and
-- dismisses it (which simply sets this column back to NULL).
--
--   change_alert = { prev_baseline, prev_job_price, baseline, job_price, at }
--
-- Idempotent: safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS change_alert JSONB;
