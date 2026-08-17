-- 040: Personal goals — a rep's weekly + monthly commitments, tracked on the
-- Goals page (which replaces the Team page) and mirrored on their Home card.
--
-- One row per rep per period: period 'week' (period_start = the Sunday) or
-- 'month' (period_start = the 1st). Three targets:
--   est_target     — SELF-GEN estimates to run (leads ran are displayed
--                    alongside but never goaled — activity the rep controls)
--   deals_target   — deals closed (owner-credited, like every leaderboard)
--   revenue_target — baseline $ (monthly revenue also mirrors into rep_goals
--                    so the Performance page's goal fallback stays in sync)
--
-- Goals CARRY FORWARD client-side: a period with no row inherits the most
-- recent earlier row of the same period type, so a new week never starts
-- blank. Write rules mirror rep_goals (024): admins, the rep themselves, or
-- the rep's direct manager. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS personal_goals (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rep_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period         TEXT NOT NULL CHECK (period IN ('week','month')),
  period_start   DATE NOT NULL,
  est_target     INT           CHECK (est_target     IS NULL OR est_target     >= 0),
  deals_target   INT           CHECK (deals_target   IS NULL OR deals_target   >= 0),
  revenue_target NUMERIC(12,2) CHECK (revenue_target IS NULL OR revenue_target >= 0),
  updated_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (rep_id, period, period_start)
);

CREATE INDEX IF NOT EXISTS personal_goals_rep_idx ON personal_goals (rep_id, period, period_start DESC);

ALTER TABLE personal_goals ENABLE ROW LEVEL SECURITY;

-- Everyone reads (the Goals page shows the whole roster — goals are targets,
-- not commission data).
DROP POLICY IF EXISTS personal_goals_read ON personal_goals;
CREATE POLICY personal_goals_read ON personal_goals
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins, the rep themselves, or the rep's direct manager.
DROP POLICY IF EXISTS personal_goals_write ON personal_goals;
CREATE POLICY personal_goals_write ON personal_goals
  FOR ALL TO authenticated
  USING (
    my_role() = 'admin'
    OR rep_id = my_profile_id()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = personal_goals.rep_id AND p.manager_id = my_profile_id())
  )
  WITH CHECK (
    my_role() = 'admin'
    OR rep_id = my_profile_id()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = personal_goals.rep_id AND p.manager_id = my_profile_id())
  );

DROP TRIGGER IF EXISTS personal_goals_touch ON personal_goals;
CREATE TRIGGER personal_goals_touch BEFORE UPDATE ON personal_goals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
