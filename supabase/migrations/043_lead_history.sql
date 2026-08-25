-- 043: Per-appointment edit history (mirrors deal_history from 019).
--
-- Leads are written from three directions — the CRM webhook (service role),
-- the CSV importer, and admins correcting a status or reassigning a closer —
-- so "who changed this, and when?" needs a real answer. A SECURITY DEFINER
-- trigger records every INSERT/UPDATE diff regardless of path.
--
-- changed_by is the editor's profile id; NULL means the CRM feed / service
-- role / direct SQL. Append-only: no client write policies, so the log can't
-- be edited from the app. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS lead_history (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES profiles(id),       -- NULL = CRM feed / SQL
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes    JSONB NOT NULL                      -- { field: { from, to }, ... }
);

CREATE INDEX IF NOT EXISTS lead_history_lead_idx ON lead_history (lead_id, changed_at DESC);

ALTER TABLE lead_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_history_select ON lead_history;
CREATE POLICY lead_history_select ON lead_history
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies on purpose — only the trigger writes.

CREATE OR REPLACE FUNCTION log_lead_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  diff  JSONB := '{}'::jsonb;
  k     TEXT;
  oldj  JSONB;
  newj  JSONB;
  actor UUID;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_history (lead_id, changed_by, changes)
    VALUES (NEW.id, actor, jsonb_build_object('_event', 'created'));
    RETURN NEW;
  END IF;

  oldj := to_jsonb(OLD);
  newj := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(newj) LOOP
    -- Skip noise: timestamps and the full CRM payload (it re-sends every sync
    -- and would bury the fields anyone actually cares about).
    IF k IN ('updated_at', 'created_at', 'raw') THEN CONTINUE; END IF;
    IF (oldj -> k) IS DISTINCT FROM (newj -> k) THEN
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', oldj -> k, 'to', newj -> k));
    END IF;
  END LOOP;

  IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
  INSERT INTO lead_history (lead_id, changed_by, changes) VALUES (NEW.id, actor, diff);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_log_changes ON leads;
CREATE TRIGGER leads_log_changes
AFTER INSERT OR UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION log_lead_changes();
