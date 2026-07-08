-- 032: Let trusted SERVICE contexts through the profiles column guard.
--
-- guard_profile_columns() reverted the privileged columns whenever the caller
-- wasn't a signed-in admin — including when there is NO signed-in caller at
-- all (auth.uid() IS NULL): GoTrue's auto-link trigger (handle_new_auth_user,
-- which stamps profiles.auth_id when a login is created for a roster email),
-- service-key API calls, and SQL run in Studio. That silently undid the
-- auth_id link on login creation, leaving "half-created" logins: the auth
-- user exists but the profile never linked, the Admin page still shows
-- "create login", and the retry fails with GoTrue's 500
-- "Database error creating new user" (duplicate email).
--
-- Anonymous API traffic can never reach this trigger (the profiles UPDATE
-- policies are TO authenticated), so auth.uid() IS NULL here always means a
-- trusted backend context — GoTrue, the service key, or an operator in
-- Studio. Signed-in non-admins are still fully guarded. Idempotent.

CREATE OR REPLACE FUNCTION guard_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR my_role() = 'admin' THEN
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

-- Link any logins that were created but never connected to their profile
-- (the exact leftovers the old guard behavior produced).
UPDATE profiles p
SET auth_id = a.id
FROM auth.users a
WHERE lower(a.email) = lower(p.email)
  AND p.auth_id IS NULL;
