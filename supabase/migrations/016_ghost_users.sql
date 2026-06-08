-- ============================================================
-- 016_ghost_users.sql — "ghost" users
-- ------------------------------------------------------------
-- Adds profiles.ghost (boolean). A ghost user's deals/revenue still count in
-- every aggregate (team totals, company revenue, etc.), but their NAME is
-- hidden from non-admins everywhere it would otherwise appear — leaderboards,
-- competitions, team rosters, rep filters. Only admins can see them.
--
-- Hiding is enforced in the frontend (the gateway still serves the rows so the
-- aggregates that reference them stay correct). The guard trigger is extended so
-- non-admins can't flip the flag on themselves.
-- Idempotent.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ghost BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-assert the privileged-column guard with `ghost` protected too.
CREATE OR REPLACE FUNCTION guard_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  NEW.role             := OLD.role;
  NEW.is_admin         := OLD.is_admin;
  NEW.ghost            := OLD.ghost;
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
