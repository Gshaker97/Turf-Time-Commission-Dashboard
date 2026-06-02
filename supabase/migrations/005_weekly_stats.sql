-- ============================================================
-- 005_weekly_stats.sql — weekly rep activity tracker
-- ------------------------------------------------------------
-- Adds the table behind the Team → Weekly Stats tab: how many estimates a
-- rep ran each week (entered manually). Closed deals + close rate are derived
-- on the frontend from the `deals` table, so they are NOT stored here.
--
-- Idempotent — safe to run on a fresh OR an already-deployed database.
-- Depends on touch_updated_at() (001) and my_role() (002), which already
-- exist in any deployed Turf Time database.
-- ============================================================

CREATE TABLE IF NOT EXISTS weekly_stats (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rep_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,                       -- Monday of the week
  estimates   INT  NOT NULL DEFAULT 0 CHECK (estimates >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID REFERENCES profiles(id),
  UNIQUE (rep_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_stats_rep  ON weekly_stats(rep_id);
CREATE INDEX IF NOT EXISTS idx_weekly_stats_week ON weekly_stats(week_start);

DROP TRIGGER IF EXISTS weekly_stats_touch ON weekly_stats;
CREATE TRIGGER weekly_stats_touch BEFORE UPDATE ON weekly_stats
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE weekly_stats ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (the Team page scopes which reps are shown).
DROP POLICY IF EXISTS weekly_stats_read ON weekly_stats;
CREATE POLICY weekly_stats_read ON weekly_stats
  FOR SELECT TO authenticated USING (TRUE);

-- Only managers and up may enter / edit estimates.
DROP POLICY IF EXISTS weekly_stats_write ON weekly_stats;
CREATE POLICY weekly_stats_write ON weekly_stats
  FOR ALL TO authenticated
  USING      (my_role() IN ('manager','director','vp','admin'))
  WITH CHECK (my_role() IN ('manager','director','vp','admin'));
