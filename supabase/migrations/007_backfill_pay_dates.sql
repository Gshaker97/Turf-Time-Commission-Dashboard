-- ============================================================
-- 007_backfill_pay_dates.sql
--
-- One-time backfill of deals.pay_date from install_date.
--
-- Pay-date rule (matches src/utils/dateRanges.js → payDateFromInstall):
--   We pay the Friday FOLLOWING the (Monday-anchored) week a job was
--   installed. e.g. installed any day the week of Mon Jun 1 → paid Fri Jun 12.
--
-- In Postgres, date_trunc('week', d) returns the Monday of that ISO week,
-- so the following Friday is simply Monday + 11 days.
--
-- Only fills deals that have an install_date but no pay_date yet — it will
-- NOT overwrite a pay date that was already set by hand. Safe to re-run
-- (idempotent): once a row has a pay_date it is skipped.
-- ============================================================

UPDATE deals
SET pay_date = (date_trunc('week', install_date)::date + 11)
WHERE install_date IS NOT NULL
  AND pay_date IS NULL;

-- Verify (optional): list what the backfill produced.
-- SELECT deal_name, install_date, pay_date FROM deals
-- WHERE install_date IS NOT NULL ORDER BY install_date;
