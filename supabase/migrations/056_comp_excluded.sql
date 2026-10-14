-- ============================================================
-- 056_comp_excluded.sql — pull one deal out of CONTEST SCORING only.
-- ------------------------------------------------------------
-- The case (per Keaton): a deal is sold and real — it pays commission, it is
-- in revenue, it will install — but it should not win a sales contest yet,
-- because something about it is unfinished (finance docs not signed, etc.).
--
-- None of the three states we already had says that:
--   • `Canceled` (status)        — the job fell through. It did not.
--   • `hidden` (migration 052)   — the job is real but is not ours to count
--                                  ANYWHERE: no revenue, no commission, no
--                                  payroll. Far too strong; the rep still
--                                  gets paid for this one.
--   • `competitions.excluded_ids` (047) — excludes a PERSON from a Team
--                                  Average contest, not a deal.
--
-- So this is a fourth, much narrower flag: the deal counts everywhere the
-- money is, and counts nowhere a trophy is. It applies to EVERY competition
-- by default (per Keaton: "exclude deals from counting ... for all
-- competitions as the default") — the flag lives on the deal, not on a
-- competition, so it does not have to be re-applied contest by contest.
--
-- The deal is still LISTED in a competition's drill-down, struck out with an
-- "excluded" badge and worth 0 — the same treatment Canceled already gets
-- there, so an admin can always see what WOULD count and undo it.
--
-- Read by src/utils/competition.js ONLY (`compExcluded`). It is deliberately
-- NOT part of countsInTotals() in src/utils/commission.js: no payout, KPI,
-- leaderboard, record, goal or backup-export figure changes because of it.
--
-- Idempotent: safe to re-run.
-- ============================================================

SET search_path TO public;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS comp_excluded      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS comp_excluded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comp_excluded_by   UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS comp_excluded_note TEXT;

-- Excluded deals are a small minority, so a partial index keeps any audit
-- query cheap without weighing down every other read (same shape as 052's).
CREATE INDEX IF NOT EXISTS deals_comp_excluded_idx
  ON public.deals (comp_excluded) WHERE comp_excluded;

COMMENT ON COLUMN public.deals.comp_excluded IS
  'TRUE = earns no credit in ANY sales competition (standings, rounds, team averages) while counting normally in revenue, commission, payroll, records and the backup export. Still listed in a competition drill-down, struck out and worth 0. See compExcluded() in src/utils/competition.js.';

-- ── The pay-run lock must not freeze this flag ───────────────
-- A contest flag has nothing to do with a payout, but `guard_locked_payroll()`
-- (028 → 034 → 035 → 039) rejects ANY update to a finalized/paid deal on a
-- locked run. Without this allowance, a deal excluded before payout could
-- never be let back INTO the contest once its run locked — and the lock's
-- whole purpose is to protect money, which these four columns do not touch.
-- Same reasoning, and the same shape, as 039's change_alert allowance.
CREATE OR REPLACE FUNCTION guard_locked_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  finalized CONSTANT TEXT[] := ARRAY['Pay Finalized', 'Paid'];
BEGIN
  -- Adjustments are always part of the payout — fully frozen on a locked run.
  IF TG_TABLE_NAME = 'payroll_adjustments' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pay_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = OLD.pay_date) THEN
      RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', OLD.pay_date;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pay_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = NEW.pay_date) THEN
      RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', NEW.pay_date;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Allowed on a locked run #1: acknowledging the payout.
  -- Pay Finalized → Paid with every other column untouched (updated_at is
  -- stamped by a later trigger, so it's excluded from the comparison).
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'Pay Finalized' AND NEW.status = 'Paid'
     AND (to_jsonb(OLD) - 'status' - 'updated_at') = (to_jsonb(NEW) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Allowed on a locked run #2: the sheet-change alert lifecycle, and #3:
  -- the competition-exclusion flag. Both are informational as far as the
  -- payout is concerned — permitted as long as nothing else on the deal
  -- changes.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'change_alert' - 'synced_baseline' - 'synced_job_price'
            - 'comp_excluded' - 'comp_excluded_at' - 'comp_excluded_by' - 'comp_excluded_note'
            - 'updated_at')
       = (to_jsonb(NEW) - 'change_alert' - 'synced_baseline' - 'synced_job_price'
            - 'comp_excluded' - 'comp_excluded_at' - 'comp_excluded_by' - 'comp_excluded_note'
            - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Deals: freeze only the locked run's PAYOUT (finalized/paid deals)...
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pay_date IS NOT NULL
     AND OLD.status = ANY (finalized)
     AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = OLD.pay_date) THEN
    RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', OLD.pay_date;
  END IF;
  -- ...and never let a deal become part of it (no finalizing onto a locked run).
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pay_date IS NOT NULL
     AND NEW.status = ANY (finalized)
     AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = NEW.pay_date) THEN
    RAISE EXCEPTION 'Pay run % is locked — a deal cannot be finalized onto it; unlock it on the Payroll page first', NEW.pay_date;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Anything currently pulled from contests (should be none on first run):
--   SELECT id, deal_name, sale_date, comp_excluded_at, comp_excluded_note
--     FROM public.deals WHERE comp_excluded;
