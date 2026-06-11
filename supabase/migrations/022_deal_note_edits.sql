-- 022: Deal-note editing + admin delete, with a tamper-proof edit trail.
-- Authors may edit their OWN notes; every edit snapshots the previous text +
-- timestamp into `edits` via a DB trigger (the client cannot skip or fake it,
-- and authorship/deal/created_at are locked). Only admins may delete notes.
-- Idempotent: safe to run more than once.

ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS edits JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION log_deal_note_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The trail is server-owned: ignore whatever the client sent for these.
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edits     := coalesce(OLD.edits, '[]'::jsonb)
                     || jsonb_build_object('at', now(), 'body', OLD.body);
    NEW.edited_at := now();
  ELSE
    NEW.edits     := OLD.edits;
    NEW.edited_at := OLD.edited_at;
  END IF;
  -- Authorship, deal, and creation time can never change.
  NEW.author_id  := OLD.author_id;
  NEW.deal_id    := OLD.deal_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS deal_notes_log_edit ON deal_notes;
CREATE TRIGGER deal_notes_log_edit
BEFORE UPDATE ON deal_notes
FOR EACH ROW EXECUTE FUNCTION log_deal_note_edit();

-- Edit: own notes only.
DROP POLICY IF EXISTS deal_notes_update ON deal_notes;
CREATE POLICY deal_notes_update ON deal_notes
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()))
  WITH CHECK (author_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));

-- Delete: admins only (my_role() reports 'admin' for is_admin flag-holders too).
DROP POLICY IF EXISTS deal_notes_delete ON deal_notes;
CREATE POLICY deal_notes_delete ON deal_notes
  FOR DELETE TO authenticated
  USING (my_role() = 'admin');
