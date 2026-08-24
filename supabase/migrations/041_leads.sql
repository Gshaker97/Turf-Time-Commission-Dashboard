-- 041: leads — appointments fed in from the field CRM (RepCard), so estimates
-- stop being hand-collected on the Weekly Stats inputs.
--
-- One row per APPOINTMENT. The CRM's own id lands in external_id and is the
-- dedup key (partial UNIQUE, same backstop as deals.project_id in 033) so a
-- webhook that fires twice, or a re-sync, updates the row instead of
-- duplicating it.
--
--   status — NORMALIZED lifecycle the site reasons about:
--     'scheduled'  the appointment is on the calendar
--     'completed'  it was RUN → this is what counts as an estimate
--     'sold'       it was run and closed (also counts as an estimate)
--     'no_show' / 'canceled'  it never happened → never an estimate
--   disposition — the CRM's raw outcome text, kept verbatim for auditing.
--   raw — the original payload, so a field we didn't map is never lost.
--
-- setter_id/closer_id resolve from the CRM by EMAIL against profiles; when a
-- person can't be matched the row still lands with setter_name/closer_name
-- text (same "never drop the record" rule as the deal sync).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS leads (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source         TEXT NOT NULL DEFAULT 'repcard',
  external_id    TEXT,
  customer_name  TEXT,
  address        TEXT,
  phone          TEXT,
  email          TEXT,
  appointment_at TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','completed','sold','no_show','canceled')),
  disposition    TEXT,
  setter_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  closer_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  setter_name    TEXT,
  closer_name    TEXT,
  office         TEXT,
  notes          TEXT,
  deal_id        UUID REFERENCES deals(id) ON DELETE SET NULL,
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  raw            JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup backstop: one row per CRM appointment id (blank/NULL ids exempt).
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_external_idx
  ON leads (source, external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS leads_appointment_idx ON leads (appointment_at DESC);
CREATE INDEX IF NOT EXISTS leads_setter_idx      ON leads (setter_id);
CREATE INDEX IF NOT EXISTS leads_closer_idx      ON leads (closer_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Anyone signed in reads (the page scopes reps to their own, like Deals).
DROP POLICY IF EXISTS leads_read ON leads;
CREATE POLICY leads_read ON leads
  FOR SELECT TO authenticated USING (TRUE);

-- Admins correct rows by hand; the CRM feed writes with the service key,
-- which bypasses RLS entirely.
DROP POLICY IF EXISTS leads_write ON leads;
CREATE POLICY leads_write ON leads
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

DROP TRIGGER IF EXISTS leads_touch ON leads;
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A HUMAN'S CORRECTION WINS OVER THE FEED.
-- Closers get reassigned in the CRM, and dispositions are used inconsistently,
-- so admins fix rows here — but the feed re-posts the same appointment on
-- every sync. Without this, the feed would quietly revert those fixes (the
-- exact "my edit keeps reverting" problem the deal sync had).
--
-- Editing status/setter/closer in the site sets `pinned`. From then on a
-- SERVICE-KEY write (the feed: auth.uid() IS NULL) can still refresh timing,
-- customer details, and raw payload, but those three human-owned fields are
-- preserved. A signed-in admin can always change them (and can unpin to hand
-- the row back to the feed).
CREATE OR REPLACE FUNCTION leads_keep_manual_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.pinned AND auth.uid() IS NULL THEN
    NEW.status      := OLD.status;
    NEW.setter_id   := OLD.setter_id;
    NEW.closer_id   := OLD.closer_id;
    NEW.setter_name := OLD.setter_name;
    NEW.closer_name := OLD.closer_name;
    NEW.pinned      := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_keep_manual ON leads;
CREATE TRIGGER leads_keep_manual BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_keep_manual_fields();
