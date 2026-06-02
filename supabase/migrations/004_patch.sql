-- ============================================================
-- 004_patch.sql — idempotent fixes for ALREADY-DEPLOYED databases
-- ------------------------------------------------------------
-- If you ran 001–003 on a fresh database from this updated repo, you do
-- NOT need this file (the fixes are already baked into 001 and 002).
-- Run this ONLY on a database that was created from the OLD version,
-- to bring it up to date without losing data. Safe to run more than once.
-- ============================================================

-- 1) Deduction columns (were referenced by the New Deal form but never existed)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(12,2);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deduction_note   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'deals' AND constraint_name = 'deals_deduction_amount_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_deduction_amount_check
      CHECK (deduction_amount IS NULL OR deduction_amount >= 0);
  END IF;
END $$;

-- 2) RLS hardening — profile self-update column guard
CREATE OR REPLACE FUNCTION guard_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  NEW.role             := OLD.role;
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

DROP TRIGGER IF EXISTS profiles_guard_columns ON profiles;
CREATE TRIGGER profiles_guard_columns BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_columns();

DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- 3) RLS hardening — deals update WITH CHECK
DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals
  FOR UPDATE TO authenticated
  USING (
    my_role() IN ('manager','director','vp','admin')
    OR setter_id = my_profile_id()
    OR closer_id = my_profile_id()
  )
  WITH CHECK (
    my_role() IN ('manager','director','vp','admin')
    OR setter_id = my_profile_id()
    OR closer_id = my_profile_id()
  );
