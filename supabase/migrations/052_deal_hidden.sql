-- 052: deals.hidden — take a job out of every number without deleting it.
--
-- The case (real, Sep 2026): Keaton and Tanner Arnett (inside sales) share an
-- ArcSite login, so Tanner's jobs land on the Jobs tab stamped with KEATON's
-- name. The site only ever sees what the sheet says, so:
--   • `sync_excluded_reps` cannot help — the sheet never names Tanner.
--   • DELETING the deal does not help — the Jobs row is still there, so the
--     sync re-creates it within the minute under whatever name the sheet says.
--   • Marking it `Canceled` does drop it from every total, but it is a lie: the
--     job installed. It also shows as a canceled row in the backup spreadsheet.
--
-- `hidden` is the honest version of Canceled: this job is real, it just is not
-- ours to count. And because the ROW SURVIVES, the sync matches it by
-- project_id and never re-creates it — which is exactly why this beats a delete
-- plus a SCHED_BASELINE_IDS entry, and needs no Apps Script fiddling at all.
--
-- Mirrors `leads.ignored` (049) deliberately: a FLAG, not a delete, for the
-- same reason — the feed would recreate whatever we removed.
--
-- The deal stays visible on the Deals page (greyed, with a Hidden badge) so it
-- can always be un-hidden; everything else — revenue, KPIs, leaderboards,
-- teams, competitions, records, goals, Performance, commissions, payroll and
-- the backup spreadsheet — skips it via `countsInTotals()` in
-- src/utils/commission.js.
--
-- NOTE the pay-run lock still applies: `guard_locked_payroll()` rejects an
-- UPDATE to a finalized/paid deal sitting on a locked pay date, so hiding one
-- of those fails loudly rather than silently rewriting a frozen payout. That is
-- the intended behaviour — unlock the run first if it is genuinely wrong.
--
-- Idempotent: safe to re-run.

SET search_path TO public;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_by   UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS hidden_note TEXT;

-- Hidden deals are a tiny minority, so a partial index keeps the "show hidden"
-- filter and any audit query cheap without weighing down every other read.
CREATE INDEX IF NOT EXISTS deals_hidden_idx ON public.deals (hidden) WHERE hidden;

COMMENT ON COLUMN public.deals.hidden IS
  'TRUE = excluded from every aggregate (revenue, KPIs, leaderboards, competitions, records, goals, Performance, commissions, payroll, backup export) while the row survives so the sheet sync will not re-create it. Still listed on the Deals page so it can be un-hidden. See countsInTotals() in src/utils/commission.js.';

NOTIFY pgrst, 'reload schema';

-- Anything already hidden (should be none on first run):
--   SELECT id, deal_name, sale_date, hidden_at, hidden_note FROM public.deals WHERE hidden;
