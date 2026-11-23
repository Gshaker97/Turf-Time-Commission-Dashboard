-- ============================================================
-- 062_roster_status.sql — a rep can be on the team without being IN THE COUNT.
-- ------------------------------------------------------------
-- Per Keaton (Nov 2026): "essentially for part-time users. They would
-- maintain access to the site, but not count as active reps for a team.
-- Their numbers count and show everywhere, they just dont show in the teams
-- rep count." Then: "reps who are temporarily absent. Similar approach -
-- they aren't inactive, they are just temporarily gone."
--
-- Those are the SAME mechanic (keeps access, money still counts, out of the
-- headcount) with two different reasons, so they are ONE column rather than
-- two booleans:
--
--   counted  the default, and what every existing row becomes
--   flex     sells here and there; permanent. Keaton's word, chosen over
--            "part time" (an HR/benefits term), Reserve and Associate.
--   away     temporarily gone; expected back. Carries `away_until`.
--
-- `active` is DELIBERATELY NOT TOUCHED and keeps its own meaning — access.
-- A deactivated person is blocked at login; a flex or away person signs in
-- normally. Keeping them apart is the point: someone can be flex today and
-- be deactivated next year without the two ideas fighting, which collapsing
-- them into one enum would have prevented.
--
-- WHAT IT CHANGES, and nothing else (per Keaton, asked explicitly):
--   1. the Team Average competition divisor — the "÷ N reps" on a team_avg
--      card. THEIR DEALS STILL COUNT IN THE NUMERATOR. Jordan's team sells
--      24 of which Kyltan and Matt sold 4: the score is 24 ÷ 4 = 6.0, not
--      20 ÷ 4. Keaton chose that knowing it gives a team with flex reps an
--      edge over an identical team without; `competitions.excluded_ids`
--      still exists to level one particular race, and is a DIFFERENT tool
--      because it drops their deals as well as their headcount.
--   2. the Dashboard team row's "N reps" sub-label.
-- NOT the People-chart column count, NOT the Goals page, NOT team
-- attribution, and NOT one dollar anywhere.
--
-- IT IS GUARDED, unlike `sales_role`. sales_role is display-only, so 061 left
-- it unprotected; roster_status changes a contest score, so a rep who could
-- set it on themselves could quietly shrink their own team's divisor. It
-- joins role / is_admin / ghost / active in guard_profile_columns().
--
-- NOT DATE-EFFECTIVE, and that is inherited rather than solved: flipping
-- someone to away mid-contest drops the divisor for the WHOLE contest, not
-- from that day. Deactivation already behaves this way (see the known caveat
-- under migration 047 in CLAUDE.md). If it ever needs to be exact it wants a
-- dated log like team_changes, which is a separate job.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS roster_status TEXT NOT NULL DEFAULT 'counted'
  CHECK (roster_status IN ('counted', 'flex', 'away'));

-- Optional expected return. Blank is allowed on purpose: you often don't know
-- the date when someone goes out, and forcing one would mean guessing.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS away_until DATE;

COMMENT ON COLUMN profiles.roster_status IS
  'counted (default) | flex | away. Keeps site access and keeps counting for money; only the team HEADCOUNT drops them — the team_avg divisor and the Dashboard team row. Separate from active, which is access.';
COMMENT ON COLUMN profiles.away_until IS
  'Optional expected return date for roster_status = away. Cleared by the app when the status changes.';

-- Re-assert the privileged-column guard with the two new columns protected.
-- Carried forward verbatim from 032, INCLUDING the `auth.uid() IS NULL`
-- service bypass — dropping that line would silently break login creation
-- again (GoTrue's auto-link trigger writes profiles.auth_id with no session).
CREATE OR REPLACE FUNCTION guard_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  NEW.role             := OLD.role;
  NEW.is_admin         := OLD.is_admin;
  NEW.ghost            := OLD.ghost;
  NEW.roster_status    := OLD.roster_status;
  NEW.away_until       := OLD.away_until;
  NEW.email            := OLD.email;
  NEW.auth_id          := OLD.auth_id;
  NEW.manager_id       := OLD.manager_id;
  NEW.director_id      := OLD.director_id;
  NEW.vp_id            := OLD.vp_id;
  NEW.active           := OLD.active;
  NEW.hire_date        := OLD.hire_date;
  NEW.termination_date := OLD.termination_date;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_profile_columns() SET search_path = public;

-- No seed. Keaton named Kyltan and Matt as the example, but a name typed
-- wrong here silently flags the wrong person out of a team's headcount, and
-- the roster carries more than one Matt-shaped name. Set them on
-- Admin → People instead. To do it in SQL, fill in the exact display names
-- as the People page shows them and run:
--
--   UPDATE profiles SET roster_status = 'flex'
--    WHERE roster_status = 'counted' AND name IN ('Kyltan Hedgcock', '<Matt …>');

-- PostgREST caches the schema; without this the site reports the columns as
-- unknown and every profile write fails.
NOTIFY pgrst, 'reload schema';
