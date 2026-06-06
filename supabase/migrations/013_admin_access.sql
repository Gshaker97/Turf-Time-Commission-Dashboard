-- ============================================================
-- 013_admin_access.sql — separate "admin access" from sales title
-- ------------------------------------------------------------
-- Adds profiles.is_admin (boolean). Site access is now decoupled from the
-- sales title (role = rep/manager/director/vp, which still drives overrides):
-- anyone with is_admin = true has full admin powers regardless of title.
--
-- Implemented by making my_role() report 'admin' for flag-holders, so every
-- existing RLS policy that checks my_role() treats them as admin — no policy
-- rewrites needed. The frontend still reads the real `role` column for
-- titles/overrides, so commission behavior is unchanged.
--
-- Idempotent.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- my_role() now returns 'admin' when the row carries the is_admin flag.
CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT CASE WHEN is_admin THEN 'admin' ELSE role END
  FROM profiles WHERE auth_id = auth.uid()
$$;

-- Column guard: admins (now incl. flag-holders) may change anything; everyone
-- else has privileged columns — including the new is_admin — reverted, so no
-- one can grant themselves admin access.
CREATE OR REPLACE FUNCTION guard_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  NEW.role             := OLD.role;
  NEW.is_admin         := OLD.is_admin;
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

-- Bootstrap your own account (chicken-and-egg). Edit the name/email if needed:
-- UPDATE profiles SET is_admin = TRUE WHERE name = 'Keaton Shaker';
