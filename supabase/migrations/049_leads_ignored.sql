-- 049: leads.ignored — take an appointment out of every count without
-- deleting it.
--
-- Why not delete: the feed is keyed on (source, external_id), so the next
-- webhook event for that appointment would simply recreate the row and the
-- duplicate would be back. A flag survives, because the feed only writes the
-- columns its payload actually supplied (the partial-update rule) and never
-- sends this one.
--
-- The case that forced it: RepCard creates a NEW appointment record when one
-- is reassigned to a different closer instead of updating the original, so
-- the same doorstep arrives twice with two different external_ids (real
-- example: "Eda", 6:30pm, ids 860132 → Jordan and 860191 → Stephen, created
-- 52 minutes apart). Both are genuine records to the feed; only a human can
-- say which one is the duplicate. An ignored row stays visible on the Leads
-- page, greyed, and drops out of every stat.
--
-- Idempotent: safe to re-run.

SET search_path TO public;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE;

-- Finding the duplicate groups is a customer+time lookup.
CREATE INDEX IF NOT EXISTS leads_dupe_idx ON public.leads (customer_name, appointment_at);

NOTIFY pgrst, 'reload schema';
