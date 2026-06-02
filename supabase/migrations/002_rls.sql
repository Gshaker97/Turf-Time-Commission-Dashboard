-- ============================================================
-- 002_rls.sql — Row Level Security
-- ============================================================

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;

-- ── Helpers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE auth_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION my_profile_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM profiles WHERE auth_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION reports_to(child_id UUID, ancestor_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  current_id UUID := child_id;
BEGIN
  FOR i IN 1..10 LOOP
    SELECT manager_id INTO current_id FROM profiles WHERE id = current_id;
    IF current_id IS NULL THEN RETURN FALSE; END IF;
    IF current_id = ancestor_id THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

-- ── Profile policies ─────────────────────────────────────────
-- All authenticated users can read profiles (needed for dropdowns, names)
CREATE POLICY profiles_read ON profiles
  FOR SELECT TO authenticated USING (TRUE);

-- Anyone can update their own profile, BUT a column-guard trigger (below)
-- prevents non-admins from changing privileged fields (role, hierarchy, etc.)
CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- Column guard: non-admins may only change "cosmetic" fields on their own row.
-- Privileged columns are forced back to their previous values.
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

CREATE TRIGGER profiles_guard_columns BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_columns();

-- Admins can do anything
CREATE POLICY profiles_admin_all ON profiles
  FOR ALL TO authenticated
  USING (my_role() = 'admin')
  WITH CHECK (my_role() = 'admin');

-- ── Deal visibility helper ───────────────────────────────────
CREATE OR REPLACE FUNCTION can_view_deal(d deals)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_role TEXT := my_role();
  v_id   UUID := my_profile_id();
BEGIN
  IF v_role IN ('director','vp','admin') THEN RETURN TRUE; END IF;

  -- Setter or closer can always see their own deal
  IF d.setter_id = v_id OR d.closer_id = v_id THEN RETURN TRUE; END IF;

  -- Override roles can see deals they're attached to
  IF d.manager_id = v_id OR d.director_id = v_id OR d.vp_id = v_id
    THEN RETURN TRUE; END IF;

  -- Manager can see deals from their downline
  IF v_role = 'manager' THEN
    RETURN reports_to(d.setter_id, v_id)
        OR (d.closer_id IS NOT NULL AND reports_to(d.closer_id, v_id));
  END IF;

  RETURN FALSE;
END;
$$;

-- ── Deals policies ───────────────────────────────────────────
CREATE POLICY deals_select ON deals
  FOR SELECT TO authenticated USING (can_view_deal(deals.*));

CREATE POLICY deals_insert ON deals
  FOR INSERT TO authenticated
  WITH CHECK (
    my_role() IN ('manager','director','vp','admin')
    OR setter_id = my_profile_id()
    OR closer_id = my_profile_id()
  );

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

CREATE POLICY deals_delete ON deals
  FOR DELETE TO authenticated
  USING (my_role() = 'admin');

-- ── Payments policies ────────────────────────────────────────
-- A user can see payments tied to deals they can view
CREATE POLICY payments_select ON payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = payments.deal_id
        AND can_view_deal(d.*)
    )
  );

-- Only managers+ can record/edit payments
CREATE POLICY payments_write ON payments
  FOR ALL TO authenticated
  USING (my_role() IN ('manager','director','vp','admin'))
  WITH CHECK (my_role() IN ('manager','director','vp','admin'));

-- ── Monthly goals policies ───────────────────────────────────
CREATE POLICY goals_read ON monthly_goals
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY goals_write ON monthly_goals
  FOR ALL TO authenticated
  USING (my_role() IN ('admin','vp','director'))
  WITH CHECK (my_role() IN ('admin','vp','director'));
