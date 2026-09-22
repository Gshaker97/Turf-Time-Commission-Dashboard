-- 050: the deduction LEDGER — a deduction that is owed but not yet scheduled.
--
-- The problem it solves: the office emails a deduction for a job that has
-- already been paid out. Today the only tool is a payroll adjustment, which
-- forces you to name a pay date on the spot. When the rep has no pay that
-- week there is no right answer, so it falls back on someone's memory.
--
-- The missing idea is a BALANCE OWED, not another adjustment. So:
--
--   pay_date NULL  = the DEBT. What is owed, with no run attached. It waits
--                    in the Payroll tray and follows the rep from run to run.
--   pay_date set   = a RECOVERY (parent_id -> the debt) or, with no parent,
--                    an ordinary adjustment exactly as before.
--
-- A recovery is a plain dated adjustment, which is precisely what Payroll
-- already understands, so run totals, pay statements, the CSV export and the
-- lock guard all keep working untouched. Migration 034's guard already tests
-- `pay_date IS NOT NULL` before it refuses anything, so a debt row passes
-- straight through it and NO trigger change is needed.
--
-- Deliberately NOT done here: nothing writes to deals.deduction_amount. That
-- column feeds dealAmounts(), so editing it on a paid job would silently
-- rewrite that deal's commission on every page and in the backup spreadsheet,
-- and the lock trigger would reject it anyway. A debt REFERENCES its deal.
--
-- Idempotent: safe to re-run.

SET search_path TO public;

-- The debt has no pay date. This is the whole feature in one line.
ALTER TABLE public.payroll_adjustments ALTER COLUMN pay_date DROP NOT NULL;

-- Which job it came from. NULLABLE on purpose: a tool not returned, an
-- advance or a uniform has no job behind it, and forcing one would mean
-- inventing a deal to attach it to.
ALTER TABLE public.payroll_adjustments
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL;

-- A recovery points at the debt it pays down, so a deduction collected over
-- three runs still reads as one debt instead of three unrelated lines.
ALTER TABLE public.payroll_adjustments
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.payroll_adjustments(id) ON DELETE CASCADE;

-- Closing a debt that will never be collected — a rep who has left never has
-- another pay run, so without this their balance nags on every run forever.
-- Stamped rather than deleted: what happened stays on the record.
ALTER TABLE public.payroll_adjustments ADD COLUMN IF NOT EXISTS written_off_at TIMESTAMPTZ;
ALTER TABLE public.payroll_adjustments ADD COLUMN IF NOT EXISTS written_off_by UUID;
ALTER TABLE public.payroll_adjustments ADD COLUMN IF NOT EXISTS written_off_note TEXT;

CREATE INDEX IF NOT EXISTS payroll_adjustments_parent_idx ON public.payroll_adjustments (parent_id);
-- The tray's query: every open debt, by rep.
CREATE INDEX IF NOT EXISTS payroll_adjustments_open_idx
  ON public.payroll_adjustments (payee_id) WHERE pay_date IS NULL;

NOTIFY pgrst, 'reload schema';
