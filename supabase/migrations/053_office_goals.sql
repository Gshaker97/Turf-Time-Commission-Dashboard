-- 053: per-office revenue goals.
--
-- The merged Dashboard sets a goal at every level it can scope to — company,
-- office, team, rep. Three of those already had a store:
--   • company → monthly_goals.baseline_target
--   • team    → rep_goals, scope 'team'  (subject = the head)
--   • rep     → rep_goals, scope 'rep'   (mirrored from personal_goals)
-- Office had none, and could not borrow rep_goals: its `subject_id` is a UUID
-- with a foreign key to profiles, and an office is a STRING out of
-- app_settings.offices, not a person.
--
-- So the office goal goes on monthly_goals, which is already "a revenue target
-- for a year+month" — exactly the same shape.
--
-- WHY `''` AND NOT NULL for the company row. A nullable office would be the
-- obvious modelling choice, but Postgres treats NULLs as distinct in a UNIQUE
-- constraint, so (2026, 9, NULL) could be inserted twice and the company would
-- quietly grow two conflicting goals. Partial unique indexes fix that but
-- PostgREST's `on_conflict=` can't infer a partial index, which would break the
-- upsert the Dashboard saves through. An empty string is NOT NULL, unique-able,
-- and upsertable — and it is the same sentinel `perfSummary.accumulate` already
-- uses for a deal with no office recorded, so the convention is consistent.
--
-- Existing rows take the default and stay the company goal untouched.
--
-- Idempotent: safe to re-run.

SET search_path TO public;

ALTER TABLE public.monthly_goals
  ADD COLUMN IF NOT EXISTS office TEXT NOT NULL DEFAULT '';

-- Old key was (year, month) — one goal per month, full stop. Now it is one per
-- month PER OFFICE, with '' as the company row.
ALTER TABLE public.monthly_goals DROP CONSTRAINT IF EXISTS monthly_goals_year_month_key;
DROP INDEX IF EXISTS monthly_goals_year_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS monthly_goals_year_month_office_key
  ON public.monthly_goals (year, month, office);

COMMENT ON COLUMN public.monthly_goals.office IS
  'Which office this target is for. '''' (empty string) = the COMPANY-wide goal — never NULL, because NULLs do not collide in a UNIQUE index and PostgREST cannot upsert against a partial one. Matches the '''' = no-office key used in perfSummary.';

NOTIFY pgrst, 'reload schema';

-- Check afterwards — the company rows should all read '' and nothing should
-- have doubled up:
--
--   SELECT year, month, office, baseline_target
--   FROM public.monthly_goals ORDER BY year DESC, month DESC, office;
