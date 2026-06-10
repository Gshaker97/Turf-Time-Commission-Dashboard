-- 019: Per-deal edit history.
-- A DB trigger records every INSERT/UPDATE on deals into deal_history, so the
-- log captures EVERY path — app edits, the Apps Script sync (service role),
-- and ad-hoc SQL — not just changes made through the UI.
-- changed_by is the editor's profile id; NULL means the service role (sync) or
-- a direct SQL change. Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS deal_history (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES profiles(id),       -- NULL = sync / direct SQL
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes    JSONB NOT NULL                      -- { field: { from, to }, ... }
);

CREATE INDEX IF NOT EXISTS deal_history_deal_idx ON deal_history (deal_id, changed_at DESC);

ALTER TABLE deal_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_history_select ON deal_history;
CREATE POLICY deal_history_select ON deal_history
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies on purpose: only the SECURITY DEFINER
-- trigger below writes rows, so the log is append-only and tamper-proof
-- from the client side.

CREATE OR REPLACE FUNCTION log_deal_changes() RETURNS trigger
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
    INSERT INTO deal_history (deal_id, changed_by, changes)
    VALUES (NEW.id, actor, jsonb_build_object('_event', 'created'));
    RETURN NEW;
  END IF;

  oldj := to_jsonb(OLD);
  newj := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(newj) LOOP
    -- Skip noise: timestamps and the retired checklist column.
    IF k IN ('updated_at', 'created_at', 'checklist') THEN CONTINUE; END IF;
    IF (oldj -> k) IS DISTINCT FROM (newj -> k) THEN
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', oldj -> k, 'to', newj -> k));
    END IF;
  END LOOP;

  IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
  INSERT INTO deal_history (deal_id, changed_by, changes) VALUES (NEW.id, actor, diff);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS deals_log_changes ON deals;
CREATE TRIGGER deals_log_changes
AFTER INSERT OR UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION log_deal_changes();
