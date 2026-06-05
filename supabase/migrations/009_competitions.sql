-- ============================================================
-- 009_competitions.sql — sales competitions
-- ------------------------------------------------------------
-- Stores competition definitions; standings are computed on the frontend
-- from the deals table (with optional manual score overrides per entrant).
--
-- type:    'individual' | 'team' | 'company' | 'matchup'
-- metric:  'revenue' (baseline_revenue) | 'deals' (count)
-- participant_ids: user ids (individual/matchup) or manager ids (team).
--                  Ignored for 'company' (auto-includes all sellers).
-- manual_scores:   { "<entrant_id>": <number> } overrides for an entrant.
--
-- Idempotent. Read by everyone; created/edited by VP & admin.
-- Depends on touch_updated_at() (001) and my_role() (002).
-- ============================================================

CREATE TABLE IF NOT EXISTS competitions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  rules           TEXT,
  type            TEXT NOT NULL DEFAULT 'individual',
  metric          TEXT NOT NULL DEFAULT 'revenue',
  start_date      DATE,
  end_date        DATE,
  participant_ids UUID[] DEFAULT '{}',
  manual_scores   JSONB  DEFAULT '{}'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID REFERENCES profiles(id)
);

DROP TRIGGER IF EXISTS competitions_touch ON competitions;
CREATE TRIGGER competitions_touch BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can see competitions.
DROP POLICY IF EXISTS competitions_read ON competitions;
CREATE POLICY competitions_read ON competitions
  FOR SELECT TO authenticated USING (TRUE);

-- VP & admin manage them.
DROP POLICY IF EXISTS competitions_write ON competitions;
CREATE POLICY competitions_write ON competitions
  FOR ALL TO authenticated
  USING      (my_role() IN ('vp','admin'))
  WITH CHECK (my_role() IN ('vp','admin'));
