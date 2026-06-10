-- 021: Threaded deal notes + in-app notifications.
-- deal_notes: append-only comment thread per deal (replaces the single
--   free-text deals.notes box; old notes still display as a legacy entry).
-- notifications: the bell in the top bar. Posting a note fans out a row to
--   each interested person (deal's setter/closer/manager, admins, and prior
--   thread participants — minus the author).
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS deal_notes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES profiles(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_notes_deal_idx ON deal_notes (deal_id, created_at);

ALTER TABLE deal_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_notes_select ON deal_notes;
CREATE POLICY deal_notes_select ON deal_notes
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS deal_notes_insert ON deal_notes;
CREATE POLICY deal_notes_insert ON deal_notes
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));
-- No update/delete: the thread is append-only, like the edit history.

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id    UUID REFERENCES deals(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- You can only read/mark-read your OWN notifications; any signed-in user may
-- CREATE rows (posting a note writes notifications into other people's feeds).
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));
