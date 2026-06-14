-- 024: Per-rep + per-team monthly goals, shared across devices.
-- Previously these lived in each browser's localStorage, so a goal set on one
-- device (or by a manager) was invisible everywhere else. This persists them so
-- any authorized editor's change is seen and saved for everyone.
--   scope='rep'  → subject_id is the rep's profile id (their personal goal)
--   scope='team' → subject_id is the manager's profile id (their team goal)
-- (company-wide goal stays in monthly_goals.) Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS rep_goals (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL DEFAULT 'rep' CHECK (scope IN ('rep','team')),
  year       INT  NOT NULL,
  month      INT  NOT NULL CHECK (month BETWEEN 1 AND 12),
  target     NUMERIC(12,2) NOT NULL CHECK (target >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (subject_id, scope, year, month)
);

ALTER TABLE rep_goals ENABLE ROW LEVEL SECURITY;

-- Everyone can read goals (the Team page shows them for the whole team).
DROP POLICY IF EXISTS rep_goals_read ON rep_goals;
CREATE POLICY rep_goals_read ON rep_goals
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins (any), the subject themselves (own personal/team goal), or the
-- subject's direct manager (a manager editing one of their reps' goals). This
-- mirrors the frontend canEditGoal rule.
DROP POLICY IF EXISTS rep_goals_write ON rep_goals;
CREATE POLICY rep_goals_write ON rep_goals
  FOR ALL TO authenticated
  USING (
    my_role() = 'admin'
    OR subject_id = my_profile_id()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = rep_goals.subject_id AND p.manager_id = my_profile_id())
  )
  WITH CHECK (
    my_role() = 'admin'
    OR subject_id = my_profile_id()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = rep_goals.subject_id AND p.manager_id = my_profile_id())
  );

DROP TRIGGER IF EXISTS rep_goals_touch ON rep_goals;
CREATE TRIGGER rep_goals_touch BEFORE UPDATE ON rep_goals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
