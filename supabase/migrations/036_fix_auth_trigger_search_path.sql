-- 036: Fix GoTrue 500 "Database error creating new user" on login creation.
--
-- GoTrue's database connection runs with search_path = auth. When it inserts
-- the new auth user, our auto-link trigger (handle_new_auth_user) fires and
-- runs `UPDATE profiles ...` UNQUALIFIED — which resolves against the auth
-- schema, finds no such table, and the error aborts the entire user creation.
-- (Studio's old manual Add-User path ran as postgres with search_path=public,
-- which is why creating logins by hand used to work.)
--
-- Fix: pin search_path = public on the trigger function and schema-qualify
-- the table. Nested trigger functions (the profiles column guard, the
-- team-change logger and their my_role()/my_profile_id() helpers) inherit the
-- pinned search_path, but they get pinned too for good measure. Idempotent.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If a profile with this email already exists (the roster), link it.
  UPDATE public.profiles SET auth_id = NEW.id
  WHERE lower(email) = lower(NEW.email) AND auth_id IS NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.my_role()               SET search_path = public;
ALTER FUNCTION public.my_profile_id()         SET search_path = public;
ALTER FUNCTION public.guard_profile_columns() SET search_path = public;
ALTER FUNCTION public.log_team_change()       SET search_path = public;
