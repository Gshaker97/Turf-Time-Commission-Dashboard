-- 037: Performance targets — "what we should be doing" at any scope + grain,
-- powering the goal lines and vs-target readouts on the Performance page.
-- One row = a target VALUE for a metric, at a scope (org / team / office /
-- rep), per period grain (week / month / quarter / year), from an effective
-- date forward (era-style, like override rates — adding a new target never
-- rewrites how past periods were judged).
--
--   scope 'org'    → subject NULL
--   scope 'team'   → subject = the team lead's profile id (uuid as text)
--   scope 'office' → subject = office name, lowercased ('phoenix', 'tucson')
--   scope 'rep'    → subject = the rep's profile id (uuid as text)
--
-- Metrics: 'revenue' (baseline $), 'deals' (count), 'estimates' (count),
-- 'close_rate' / 'cancel_rate' / 'markup_pct' (human percents, 40 = 40%).
-- Count/$ targets scale across grains (a weekly target ×13 draws a quarterly
-- line); percent targets apply as-is at every grain. Resolution happens in
-- src/utils/performance.js — the DB just stores the rows.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS targets (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('org','team','office','rep')),
  subject    TEXT,
  metric     TEXT NOT NULL CHECK (metric IN ('revenue','deals','estimates','close_rate','cancel_rate','markup_pct')),
  period     TEXT NOT NULL CHECK (period IN ('week','month','quarter','year')),
  value      NUMERIC(14,2) NOT NULL,
  effective  DATE NOT NULL DEFAULT '2026-01-01',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS targets_lookup_idx ON targets (scope, metric, period);

ALTER TABLE targets ENABLE ROW LEVEL SECURITY;

-- Anyone signed in reads (the page is route-guarded to manager+); admins write.
DROP POLICY IF EXISTS targets_read ON targets;
CREATE POLICY targets_read ON targets
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS targets_write ON targets;
CREATE POLICY targets_write ON targets
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');
