-- ============================================================
-- 060_setter_optional.sql — a sold job must import even when the sheet's
-- Sales Rep matches nobody on the roster.
-- ------------------------------------------------------------
-- The case: "Richard Burkey", sold by Andrew Sipila, never reached the site.
-- `schDiagnose` said WOULD CREATE ✓ — nothing in the sheet or the config
-- blocked it — and a manual `schSync` showed why:
--
--   null value in column "setter_id" of relation "deals"
--   violates not-null constraint   (23502)
--
-- ScheduleSync.gs has imported an unresolved Sales Rep since Oct 2026, on
-- purpose: "the deal is the money, the name is fixable: it lands with NO
-- setter/closer (held in Needs review, amber-flagged in Payroll)". The app
-- is built for that — `saleOwnerId` falls back to the closer and then to
-- null, the team breakdowns carry an Unassigned bucket so totals still sum,
-- Payroll renders an unpayable share as amber "Unassigned", and
-- needsReview.js line 16 is literally `if (!deal.setter_id) missing.push
-- ('setter')`, which holds the deal in the Needs-review tab until somebody
-- assigns one.
--
-- Every layer was ready except this column, declared NOT NULL back in
-- 001_schema.sql. So the INSERT was rejected on every single run, once a
-- minute, and the only trace was `out.errors++` inside the Apps Script log.
-- Richard Burkey had been failing for a day; Edward Grabowski (Jacob
-- Blackner, sale date 2026-08-26) had been failing for over two months and
-- nobody knew. A silent retry loop is the worst way to lose a sale.
--
-- WHY NULLABLE RATHER THAN A PLACEHOLDER REP: inventing an "Unassigned"
-- profile to satisfy the constraint would put a fake person on leaderboards,
-- payroll runs and the commission engine, and every consumer would then need
-- to special-case that id — which is exactly what NULL already means, and
-- what every reader of this column already handles. `closer_id` has been
-- nullable since 001; this only brings `setter_id` into line with it.
--
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op.
-- ============================================================

SET search_path TO public;

ALTER TABLE public.deals ALTER COLUMN setter_id DROP NOT NULL;

COMMENT ON COLUMN public.deals.setter_id IS
  'Who set the job. NULLABLE (migration 060): a sold job whose sheet Sales Rep matches no roster profile still imports, with no setter, and is held in the Needs-review tab until one is assigned. A sale must never be invisible because a name was not recognised.';

NOTIFY pgrst, 'reload schema';

-- The two sales this was silently rejecting, once the sync next runs:
--   SELECT deal_name, sale_date, baseline_revenue, setter_id, closer_id, status
--     FROM deals
--    WHERE deal_name IN ('Richard Burkey', 'Edward Grabowski')
--    ORDER BY sale_date;
--
-- Everything still missing a setter (the Needs-review worklist):
--   SELECT deal_name, sale_date, baseline_revenue
--     FROM deals WHERE setter_id IS NULL AND NOT hidden
--    ORDER BY sale_date DESC;
