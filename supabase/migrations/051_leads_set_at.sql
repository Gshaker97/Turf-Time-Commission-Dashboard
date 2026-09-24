-- 051: leads.set_at — WHEN THE APPOINTMENT WAS BOOKED.
--
-- Every appointment figure was dated by `appointment_at`, the time the
-- appointment is scheduled FOR. That is right for "ran" and "sold" — those
-- happened on the day the appointment happened — but wrong for "set": a rep
-- who books ten appointments on Tuesday for the following week showed zero
-- Set on Tuesday and ten next week. Per Keaton: a set counts on the day it
-- was set; a run counts on the day it ran.
--
-- The two dates now come from different columns, so a date range answers two
-- honest questions at once: what did this rep BOOK in this window, and what
-- RAN in it.
--
-- Backfill: the ingest stores the whole incoming payload in `raw`, so the
-- real booking time is recoverable for rows the feed created — RepCard sends
-- it as `createdAt` on every contact. Rows where the payload carries no
-- usable timestamp fall back to `created_at`, which is when OUR row first
-- appeared. That is close to the booking time for anything that arrived live
-- on the webhook, and is the IMPORT date for the initial bulk load — so
-- pre-webhook history will cluster on the import day. Nothing can recover a
-- date the feed never sent; the engine falls back to the appointment day when
-- `set_at` is null, so no appointment ever drops out of a count.
--
-- Idempotent: safe to re-run (it only fills nulls).

SET search_path TO public;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS set_at TIMESTAMPTZ;

-- The Set column's date filter.
CREATE INDEX IF NOT EXISTS leads_set_at_idx ON public.leads (set_at);

-- Guarded casts: `raw` is whatever the CRM sent, so a value is only cast when
-- it actually starts like a date. A bad cast would abort the whole statement.
UPDATE public.leads
SET set_at = CASE
  WHEN raw->>'createdAt'   ~ '^\d{4}-\d{2}-\d{2}' THEN (raw->>'createdAt')::timestamptz
  WHEN raw->>'created_at'  ~ '^\d{4}-\d{2}-\d{2}' THEN (raw->>'created_at')::timestamptz
  WHEN raw->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}' THEN (raw->>'dateCreated')::timestamptz
  WHEN raw->>'created'     ~ '^\d{4}-\d{2}-\d{2}' THEN (raw->>'created')::timestamptz
  ELSE created_at
END
WHERE set_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- How well the backfill did — run this after, it costs nothing:
--
--   SELECT
--     count(*) FILTER (WHERE raw->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}') AS from_the_payload,
--     count(*) FILTER (WHERE raw->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}' OR raw->>'createdAt' IS NULL) AS fell_back_to_row_date,
--     count(*) AS total
--   FROM public.leads;
