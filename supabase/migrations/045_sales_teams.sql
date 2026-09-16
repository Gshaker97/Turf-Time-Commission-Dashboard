-- ============================================================
-- 045_sales_teams.sql — Sales teams + monthly team-revenue bonus
-- ------------------------------------------------------------
-- Adds a lightweight "bonus pod" model on TOP of the existing reports-to
-- hierarchy (this is deliberately separate from utils/team.js / team_changes,
-- which model the org chart). A sales team has a LEAD who earns a monthly bonus
-- based on the team's total revenue.
--
--   • sales_teams   — one row per bonus pod (name, lead, active)
--   • team_members  — date-effective membership (joined_at / left_at) so a
--                     rep's revenue only counts for the window they were on
--                     the team
--   • bonus_tiers   — the revenue → bonus schedule (editable without code;
--                     team_id NULL = the default schedule used by every team)
--
-- Revenue convention (MUST match the rest of the app — CLAUDE.md rule #1):
--   • "Revenue" = deals.baseline_revenue (NOT job_price)
--   • Date basis = deals.sale_date (same as the Dashboard's monthly rollups)
--   • Canceled / Cancelled deals never count
--   • Each qualifying deal counts ONCE at full baseline_revenue, credited to a
--     single owner: the SETTER when the setter is an active member, else the
--     CLOSER (matches saleOwnerId — setter gets revenue credit). So a deal a
--     team closer closes for a team setter counts one time, not twice.
--
-- Access control is enforced SERVER-SIDE, not by the frontend. Who may view a
-- team's numbers:
--   • the team LEAD (their own team),
--   • an ADMIN, and
--   • the lead's management chain — the lead's manager_id / director_id / vp_id
--     (for Ricky's Team: Conner, Garrison, Keaton). Derived from the org chart,
--     never hardcoded.
-- Everyone else (Bryan, Joseph, other reps) gets nothing:
--   • RLS on sales_teams / team_members returns rows only to those viewers.
--   • team_month_summary() re-verifies the caller is one of them and raises
--     42501 (→ HTTP 403) otherwise, before returning ANY numbers.
-- (The frontend then shows the LEAD an expanded view and the oversight chain a
--  collapsed-by-default one — but that's cosmetic; access is enforced here.)
--
-- Idempotent. Safe to run on the already-deployed database.
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_teams (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name              TEXT NOT NULL,
  team_lead_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    UUID NOT NULL REFERENCES sales_teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'closer'
             CHECK (role IN ('lead','closer','setter')),
  joined_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  left_at    DATE,          -- NULL = still on the team
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonus_tiers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      UUID REFERENCES sales_teams(id) ON DELETE CASCADE,  -- NULL = default schedule
  min_revenue  NUMERIC(12,2) NOT NULL CHECK (min_revenue >= 0),
  bonus_amount NUMERIC(12,2) NOT NULL CHECK (bonus_amount >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_teams_lead    ON sales_teams(team_lead_user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team   ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user   ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_tiers_team    ON bonus_tiers(team_id);

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE sales_teams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_tiers  ENABLE ROW LEVEL SECURITY;

-- sales_teams: the lead, an admin, or the lead's management chain (manager/
-- director/vp of the lead) may see the team. Nobody else.
DROP POLICY IF EXISTS sales_teams_select ON sales_teams;
CREATE POLICY sales_teams_select ON sales_teams
  FOR SELECT TO authenticated
  USING (
    my_role() = 'admin'
    OR team_lead_user_id = my_profile_id()
    OR EXISTS (
      SELECT 1 FROM profiles lead
      WHERE lead.id = sales_teams.team_lead_user_id
        AND my_profile_id() IN (lead.manager_id, lead.director_id, lead.vp_id)
    )
  );

DROP POLICY IF EXISTS sales_teams_admin_all ON sales_teams;
CREATE POLICY sales_teams_admin_all ON sales_teams
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

-- team_members: readable only by the team's lead, an admin, or the lead's
-- management chain — so a member can never enumerate the roster or see who else
-- is on the pod.
DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members
  FOR SELECT TO authenticated
  USING (
    my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM sales_teams t
      JOIN profiles lead ON lead.id = t.team_lead_user_id
      WHERE t.id = team_members.team_id
        AND ( t.team_lead_user_id = my_profile_id()
              OR my_profile_id() IN (lead.manager_id, lead.director_id, lead.vp_id) )
    )
  );

DROP POLICY IF EXISTS team_members_admin_all ON team_members;
CREATE POLICY team_members_admin_all ON team_members
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

-- bonus_tiers: readable by admins and by any team lead (the schedule itself is
-- generic program config, but reps have no reason to read it). Writable by
-- admins only. The summary function reads it internally regardless of this.
DROP POLICY IF EXISTS bonus_tiers_select ON bonus_tiers;
CREATE POLICY bonus_tiers_select ON bonus_tiers
  FOR SELECT TO authenticated
  USING (
    my_role() = 'admin'
    OR EXISTS (SELECT 1 FROM sales_teams t WHERE t.team_lead_user_id = my_profile_id())
  );

DROP POLICY IF EXISTS bonus_tiers_admin_all ON bonus_tiers;
CREATE POLICY bonus_tiers_admin_all ON bonus_tiers
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

-- ── The authorized monthly summary ───────────────────────────
-- SECURITY DEFINER: runs as the migration owner so it can read every member's
-- deals (deals RLS would otherwise hide teammates' deals from a rep lead). It
-- re-checks the caller FIRST and refuses non-lead/non-admin callers with 403,
-- so the definer rights can never be used to leak another team's data.
CREATE OR REPLACE FUNCTION team_month_summary(p_team_id UUID, p_year INT, p_month INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role          TEXT := my_role();
  v_pid           UUID := my_profile_id();
  v_team          sales_teams%ROWTYPE;
  v_start         DATE;
  v_end           DATE;        -- exclusive
  v_revenue       NUMERIC := 0;
  v_bonus         NUMERIC;
  v_next_target   NUMERIC;
  v_next_bonus    NUMERIC;
  v_top_min       NUMERIC;
  v_has_team_tiers BOOLEAN;
  v_members       JSONB;
  v_tiers         JSONB;
BEGIN
  IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'Invalid year/month' USING errcode = '22023';
  END IF;

  SELECT * INTO v_team FROM sales_teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found' USING errcode = 'no_data_found';
  END IF;

  -- Authorization — the whole point. The lead, an admin, or the lead's
  -- management chain (manager/director/vp of the lead). Everyone else: 403.
  IF v_role IS DISTINCT FROM 'admin'
     AND v_team.team_lead_user_id IS DISTINCT FROM v_pid
     AND NOT EXISTS (
       SELECT 1 FROM profiles lead
       WHERE lead.id = v_team.team_lead_user_id
         AND v_pid IN (lead.manager_id, lead.director_id, lead.vp_id)
     )
  THEN
    RAISE EXCEPTION 'Not authorized to view this team' USING errcode = '42501';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + INTERVAL '1 month')::date;

  -- Team revenue: each qualifying deal once, at full baseline_revenue.
  WITH mem AS (
    SELECT user_id, joined_at, left_at FROM team_members WHERE team_id = p_team_id
  ),
  dd AS (
    SELECT
      dl.id,
      dl.baseline_revenue AS revenue,
      dl.sale_date,
      dl.setter_id,
      dl.closer_id,
      EXISTS (SELECT 1 FROM mem WHERE mem.user_id = dl.setter_id
                AND dl.sale_date >= mem.joined_at
                AND (mem.left_at IS NULL OR dl.sale_date < mem.left_at)) AS setter_member,
      EXISTS (SELECT 1 FROM mem WHERE mem.user_id = dl.closer_id
                AND dl.sale_date >= mem.joined_at
                AND (mem.left_at IS NULL OR dl.sale_date < mem.left_at)) AS closer_member
    FROM deals dl
    WHERE dl.sale_date >= v_start
      AND dl.sale_date <  v_end
      AND lower(coalesce(dl.status, '')) NOT IN ('canceled', 'cancelled')
  ),
  q AS (
    SELECT id, revenue FROM dd WHERE setter_member OR closer_member
  )
  SELECT coalesce(sum(revenue), 0) INTO v_revenue FROM q;

  -- Per-member breakdown. Every member active at any point in the month gets a
  -- row (even at $0). Revenue is credited to one owner per deal (setter first,
  -- else closer) so the rows always sum to v_revenue.
  WITH mem AS (
    SELECT user_id, joined_at, left_at FROM team_members WHERE team_id = p_team_id
  ),
  dd AS (
    SELECT
      dl.id,
      dl.baseline_revenue AS revenue,
      dl.sale_date,
      dl.setter_id,
      dl.closer_id,
      EXISTS (SELECT 1 FROM mem WHERE mem.user_id = dl.setter_id
                AND dl.sale_date >= mem.joined_at
                AND (mem.left_at IS NULL OR dl.sale_date < mem.left_at)) AS setter_member,
      EXISTS (SELECT 1 FROM mem WHERE mem.user_id = dl.closer_id
                AND dl.sale_date >= mem.joined_at
                AND (mem.left_at IS NULL OR dl.sale_date < mem.left_at)) AS closer_member
    FROM deals dl
    WHERE dl.sale_date >= v_start
      AND dl.sale_date <  v_end
      AND lower(coalesce(dl.status, '')) NOT IN ('canceled', 'cancelled')
  ),
  q AS (
    SELECT revenue, CASE WHEN setter_member THEN setter_id ELSE closer_id END AS owner_id
    FROM dd WHERE setter_member OR closer_member
  ),
  per AS (
    SELECT owner_id, count(*)::int AS deals, sum(revenue) AS revenue FROM q GROUP BY owner_id
  ),
  active AS (
    SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.role
    FROM team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.joined_at < v_end
      AND (tm.left_at IS NULL OR tm.left_at >= v_start)
    ORDER BY tm.user_id, tm.joined_at DESC
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', a.user_id,
        'name',    p.name,
        'role',    a.role,
        'deals',   coalesce(per.deals, 0),
        'revenue', coalesce(per.revenue, 0)
      )
      ORDER BY coalesce(per.revenue, 0) DESC, p.name
    ), '[]'::jsonb)
  INTO v_members
  FROM active a
  JOIN profiles p ON p.id = a.user_id
  LEFT JOIN per ON per.owner_id = a.user_id;

  -- Which tier schedule applies: team-specific overrides the default (NULL).
  SELECT EXISTS (SELECT 1 FROM bonus_tiers WHERE active AND team_id = p_team_id)
    INTO v_has_team_tiers;

  -- Locked-in bonus = highest tier whose threshold is fully reached (no
  -- compounding, no proration). Below the lowest tier → NULL → 0.
  SELECT bonus_amount INTO v_bonus
  FROM bonus_tiers
  WHERE active
    AND (CASE WHEN v_has_team_tiers THEN team_id = p_team_id ELSE team_id IS NULL END)
    AND min_revenue <= v_revenue
  ORDER BY min_revenue DESC
  LIMIT 1;
  v_bonus := coalesce(v_bonus, 0);

  -- Next tier not yet reached (NULL when already at/above the top tier).
  SELECT min_revenue, bonus_amount INTO v_next_target, v_next_bonus
  FROM bonus_tiers
  WHERE active
    AND (CASE WHEN v_has_team_tiers THEN team_id = p_team_id ELSE team_id IS NULL END)
    AND min_revenue > v_revenue
  ORDER BY min_revenue ASC
  LIMIT 1;

  SELECT max(min_revenue) INTO v_top_min
  FROM bonus_tiers
  WHERE active
    AND (CASE WHEN v_has_team_tiers THEN team_id = p_team_id ELSE team_id IS NULL END);

  -- Tier list for the progress-bar ticks.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('min_revenue', min_revenue, 'bonus_amount', bonus_amount)
      ORDER BY min_revenue
    ), '[]'::jsonb)
  INTO v_tiers
  FROM bonus_tiers
  WHERE active
    AND (CASE WHEN v_has_team_tiers THEN team_id = p_team_id ELSE team_id IS NULL END);

  RETURN jsonb_build_object(
    'team_id',     v_team.id,
    'team_name',   v_team.name,
    'year',        p_year,
    'month',       p_month,
    'revenue',     v_revenue,
    'bonus',       v_bonus,
    'next_target', v_next_target,
    'next_bonus',  v_next_bonus,
    'gap',         CASE WHEN v_next_target IS NULL THEN NULL
                        ELSE greatest(v_next_target - v_revenue, 0) END,
    'max_tier',    (v_next_target IS NULL AND v_top_min IS NOT NULL AND v_revenue >= v_top_min),
    'tiers',       v_tiers,
    'members',     v_members
  );
END;
$$;

GRANT EXECUTE ON FUNCTION team_month_summary(UUID, INT, INT) TO authenticated;

-- ── Seed: the default bonus schedule (team_id NULL) ──────────
INSERT INTO bonus_tiers (team_id, min_revenue, bonus_amount)
SELECT NULL, v.min_revenue, v.bonus_amount
FROM (VALUES
  (200000, 2000),
  (300000, 4000),
  (400000, 6000),
  (500000, 8000),
  (600000, 10000),
  (700000, 12000)
) AS v(min_revenue, bonus_amount)
WHERE NOT EXISTS (
  SELECT 1 FROM bonus_tiers b WHERE b.team_id IS NULL AND b.min_revenue = v.min_revenue
);

-- ── Seed: "Ricky's Team" — Ricky (lead) + Bryan + Joseph ─────
-- Resolves people by NAME (the live roster uses personal Gmail logins, not
-- company emails, so name is the stable key across both live and a fresh 003
-- seed). Joseph Burgos is NOT in the roster, so a placeholder profile is created
-- for him — fix his email and create his login in Admin → Users afterward.
-- Members join at the start of the current month (adjust joined_at if the pod
-- started earlier).
DO $$
DECLARE
  v_ricky  UUID;
  v_bryan  UUID;
  v_joseph UUID;
  v_team   UUID;
  v_start  DATE := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  -- Exact full name (case-insensitive); prefer an active row. 'Ricky Marrugo'
  -- is matched in full so it never picks up a different Ricky.
  SELECT id INTO v_ricky  FROM profiles WHERE lower(name) = 'ricky marrugo' ORDER BY active DESC LIMIT 1;
  SELECT id INTO v_bryan  FROM profiles WHERE lower(name) = 'bryan burgos'  ORDER BY active DESC LIMIT 1;
  SELECT id INTO v_joseph FROM profiles WHERE lower(name) = 'joseph burgos' ORDER BY active DESC LIMIT 1;

  IF v_ricky IS NULL THEN
    RAISE NOTICE '045 team seed skipped: Ricky Marrugo not found.';
    RETURN;
  END IF;

  IF v_joseph IS NULL THEN
    INSERT INTO profiles (name, email, role, company_name, manager_id, director_id, vp_id, active)
    SELECT 'Joseph Burgos', 'joseph.burgos.placeholder@turftimeaz.com', 'rep', 'Turf Time',
           r.manager_id, r.director_id, r.vp_id, TRUE
    FROM profiles r WHERE r.id = v_ricky
    RETURNING id INTO v_joseph;
    RAISE NOTICE 'Created placeholder profile for Joseph Burgos — set his real email + login in Admin → Users.';
  END IF;

  SELECT id INTO v_team FROM sales_teams WHERE name = 'Ricky''s Team' LIMIT 1;
  IF v_team IS NULL THEN
    INSERT INTO sales_teams (name, team_lead_user_id, active)
    VALUES ('Ricky''s Team', v_ricky, TRUE)
    RETURNING id INTO v_team;
  ELSE
    UPDATE sales_teams SET team_lead_user_id = v_ricky, active = TRUE WHERE id = v_team;
  END IF;

  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, v_ricky, 'lead', v_start
  WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND user_id = v_ricky AND left_at IS NULL);

  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, v_bryan, 'setter', v_start
  WHERE v_bryan IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND user_id = v_bryan AND left_at IS NULL);

  INSERT INTO team_members (team_id, user_id, role, joined_at)
  SELECT v_team, v_joseph, 'setter', v_start
  WHERE v_joseph IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_team AND user_id = v_joseph AND left_at IS NULL);
END $$;

-- PostgREST caches the schema; tell it about the new table/function so the RPC
-- and RLS-scoped selects work without a service restart.
NOTIFY pgrst, 'reload schema';
