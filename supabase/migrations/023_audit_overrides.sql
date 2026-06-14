-- 023: Requires-Audit override log.
-- Append-only record of every manual commission correction made from the
-- Requires-Audit panel (Keaton / admin). The panel flags deals where the stored
-- sheet amounts disagree with the rules engine (src/utils/commission.js).
-- Correcting a field writes the new value back onto the deal (logged separately
-- by the 019 deal_history trigger) AND inserts one row here per corrected field,
-- so the reconciliation trail is permanent and tamper-proof from the client.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS audit_overrides (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,                 -- e.g. 'director_amount'
  original_value  NUMERIC(12,2),                 -- the stored (sheet) value at correction time
  corrected_value NUMERIC(12,2),                 -- the value Keaton saved
  correction_note TEXT,
  corrected_by    UUID REFERENCES profiles(id),
  corrected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_overrides_deal_idx   ON audit_overrides (deal_id, corrected_at DESC);
CREATE INDEX IF NOT EXISTS audit_overrides_recent_idx ON audit_overrides (corrected_at DESC);

ALTER TABLE audit_overrides ENABLE ROW LEVEL SECURITY;

-- Read: leadership only (VP = Keaton, plus admins via my_role()'s is_admin path).
DROP POLICY IF EXISTS audit_overrides_select ON audit_overrides;
CREATE POLICY audit_overrides_select ON audit_overrides
  FOR SELECT TO authenticated
  USING (my_role() IN ('vp', 'admin'));

-- Insert: leadership only, and each row must be stamped with the author's own
-- profile id. Append-only by design — there are deliberately NO update/delete
-- policies, so a correction can never be edited or erased from the client.
DROP POLICY IF EXISTS audit_overrides_insert ON audit_overrides;
CREATE POLICY audit_overrides_insert ON audit_overrides
  FOR INSERT TO authenticated
  WITH CHECK (my_role() IN ('vp', 'admin') AND corrected_by = my_profile_id());
