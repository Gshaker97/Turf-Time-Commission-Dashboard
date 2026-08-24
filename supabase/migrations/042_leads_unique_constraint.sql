-- 042: Fix the leads dedup key so upserts actually work.
--
-- 041 created a PARTIAL unique index:
--   CREATE UNIQUE INDEX … ON leads (source, external_id)
--     WHERE external_id IS NOT NULL AND external_id <> '';
--
-- Postgres cannot resolve ON CONFLICT (source, external_id) against a partial
-- index unless the statement repeats the index predicate — which PostgREST's
-- on_conflict= parameter can't express. So every upsert failed with
-- "no unique or exclusion constraint matching the ON CONFLICT specification":
-- the webhook feed AND the CSV importer both.
--
-- A plain UNIQUE CONSTRAINT is what ON CONFLICT needs, and it loses nothing:
-- Postgres treats NULLs as distinct in a unique constraint, so appointments
-- with no external_id can still coexist (they just don't dedupe, which is the
-- same behaviour the partial index gave them). Callers never write '' — both
-- the ingest endpoint and the importer normalize blanks to NULL.
-- Idempotent: safe to re-run.

DROP INDEX IF EXISTS leads_source_external_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_source_external_key' AND conrelid = 'leads'::regclass
  ) THEN
    -- Clear any '' ids first so the constraint can be created cleanly.
    UPDATE leads SET external_id = NULL WHERE external_id = '';
    ALTER TABLE leads ADD CONSTRAINT leads_source_external_key UNIQUE (source, external_id);
  END IF;
END $$;
