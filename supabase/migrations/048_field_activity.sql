-- 048: field_activity — door-knocking activity per rep per LOCAL day, fed in
-- from the field CRM (RepCard) for the Performance page's "Field activity"
-- columns (doors knocked, first/last knock, time in field, knock days).
--
-- Two shapes the feed can arrive in, both land in ONE day row per rep:
--   • DAILY SUMMARY  — a payload that already carries a doors count for a
--     day. Upserted straight into field_activity on (source, rep_key,
--     activity_date); the summary's numbers win for that day.
--   • PER-KNOCK EVENT — one webhook per door. Inserted into field_knocks
--     (deduped on the CRM's event id), and the trigger below rolls it into
--     the rep's day row: doors +1, first/last knock min/max.
--
-- activity_date is the ARIZONA calendar day (America/Phoenix — no DST), never
-- the UTC slice: a 6:30pm knock is stored as 01:30 the next day in UTC.
--
-- rep_key is a generated column = the matched profile id, else the lowercased
-- name the CRM sent. It exists so the day-row UNIQUE key works even when a
-- rep can't be matched to the roster yet (NULLs are distinct in a UNIQUE
-- constraint; the generated text is not). Unmatched rows still land — the
-- Performance page flags them so the mapping can be fixed — and once
-- profile_id is filled in later the row simply re-keys.
--
-- Idempotent: safe to re-run. Schema-qualified throughout: Studio's SQL editor
-- once ran with a search_path that could not see `profiles`.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS public.field_activity (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source         TEXT NOT NULL DEFAULT 'repcard',
  profile_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rep_name       TEXT,
  rep_email      TEXT,
  rep_key        TEXT GENERATED ALWAYS AS (COALESCE(profile_id::text, lower(rep_name), '')) STORED,
  activity_date  DATE NOT NULL,
  doors_knocked  INTEGER NOT NULL DEFAULT 0,
  first_knock_at TIMESTAMPTZ,
  last_knock_at  TIMESTAMPTZ,
  field_minutes  INTEGER,          -- time in the field when the CRM reports it; else derived last − first
  office         TEXT,
  external_id    TEXT,             -- the CRM's own id for a daily-summary row, when it has one
  raw            JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.field_activity DROP CONSTRAINT IF EXISTS field_activity_day_key;
ALTER TABLE public.field_activity ADD  CONSTRAINT field_activity_day_key UNIQUE (source, rep_key, activity_date);
CREATE INDEX IF NOT EXISTS field_activity_date_idx    ON public.field_activity (activity_date DESC);
CREATE INDEX IF NOT EXISTS field_activity_profile_idx ON public.field_activity (profile_id);

ALTER TABLE public.field_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_activity_read ON public.field_activity;
CREATE POLICY field_activity_read ON public.field_activity
  FOR SELECT TO authenticated USING (TRUE);
-- Admins import/correct by hand (CSV importer); the feed writes with the
-- service key, which bypasses RLS.
DROP POLICY IF EXISTS field_activity_write ON public.field_activity;
CREATE POLICY field_activity_write ON public.field_activity
  FOR ALL TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');

DROP TRIGGER IF EXISTS field_activity_touch ON public.field_activity;
CREATE TRIGGER field_activity_touch BEFORE UPDATE ON public.field_activity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Per-knock events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_knocks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'repcard',
  external_id TEXT NOT NULL,       -- the CRM's event id: a webhook that fires twice is a no-op
  profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rep_name    TEXT,
  rep_email   TEXT,
  knock_at    TIMESTAMPTZ NOT NULL,
  office      TEXT,
  raw         JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.field_knocks DROP CONSTRAINT IF EXISTS field_knocks_source_external_key;
ALTER TABLE public.field_knocks ADD  CONSTRAINT field_knocks_source_external_key UNIQUE (source, external_id);
CREATE INDEX IF NOT EXISTS field_knocks_at_idx ON public.field_knocks (knock_at DESC);

ALTER TABLE public.field_knocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_knocks_read ON public.field_knocks;
CREATE POLICY field_knocks_read ON public.field_knocks
  FOR SELECT TO authenticated USING (public.my_role() = 'admin');
-- No client write policy: only the service-key feed inserts knocks.

-- Roll a new knock into its rep's Arizona day row. Runs as the table owner so
-- the service-key insert path never depends on RLS on field_activity.
CREATE OR REPLACE FUNCTION public.field_knocks_rollup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d DATE := (NEW.knock_at AT TIME ZONE 'America/Phoenix')::date;
BEGIN
  INSERT INTO public.field_activity (source, profile_id, rep_name, rep_email, activity_date,
                              doors_knocked, first_knock_at, last_knock_at, office)
  VALUES (NEW.source, NEW.profile_id, NEW.rep_name, NEW.rep_email, d,
          1, NEW.knock_at, NEW.knock_at, NEW.office)
  ON CONFLICT (source, rep_key, activity_date) DO UPDATE SET
    doors_knocked  = field_activity.doors_knocked + 1,
    first_knock_at = LEAST(field_activity.first_knock_at, EXCLUDED.first_knock_at),
    last_knock_at  = GREATEST(field_activity.last_knock_at, EXCLUDED.last_knock_at),
    profile_id     = COALESCE(field_activity.profile_id, EXCLUDED.profile_id),
    rep_email      = COALESCE(field_activity.rep_email, EXCLUDED.rep_email),
    office         = COALESCE(field_activity.office, EXCLUDED.office),
    updated_at     = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS field_knocks_rollup_trg ON public.field_knocks;
CREATE TRIGGER field_knocks_rollup_trg AFTER INSERT ON public.field_knocks
  FOR EACH ROW EXECUTE FUNCTION public.field_knocks_rollup();

NOTIFY pgrst, 'reload schema';
