-- 029: Date-stamped team-change log. Whenever a profile's reports-to
-- (manager_id) changes — a rep moved to a new team, a team absorbed into
-- another — a row is recorded with the old/new lead, who made the change, and
-- when. Trigger-only writes (any path: app, SQL); read-only for clients.
-- Shown as the "Team change log" on Admin → Users. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS team_changes (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_manager_id UUID,
  new_manager_id UUID,
  changed_by     UUID,
  changed_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE team_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_changes_read ON team_changes;
CREATE POLICY team_changes_read ON team_changes
  FOR SELECT TO authenticated USING (TRUE);
-- No client INSERT/UPDATE/DELETE policies — the trigger below is the only writer.

CREATE OR REPLACE FUNCTION log_team_change()
RETURNS TRIGGER SECURITY DEFINER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    INSERT INTO team_changes (profile_id, old_manager_id, new_manager_id, changed_by)
    VALUES (NEW.id, OLD.manager_id, NEW.manager_id, my_profile_id());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_team_change ON profiles;
CREATE TRIGGER profiles_team_change
  AFTER UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_team_change();
