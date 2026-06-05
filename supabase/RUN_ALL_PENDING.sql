-- ============================================================
-- RUN_ALL_PENDING.sql — one-shot apply of every pending DB change
-- ------------------------------------------------------------
-- Safe to run as a whole, and safe to re-run (idempotent). Run this once in
-- Supabase Studio → SQL Editor. It bundles, in order:
--   • 005  weekly_stats table          (Team → Weekly Stats)
--   • 006  app_settings + deals.payment_method  (settings page + payment saving)
--   • 007  pay_date backfill            (fills pay dates on existing deals)
--   • 008  deals.checklist column       (inline new-deal checklist)
--   • VP delete policy                  (let VPs delete deals, not just admins)
--
-- Depends on touch_updated_at() (001) and my_role() (002), which already exist.
-- If any statement errors with "must be owner" / "permission denied", the
-- postgres role used by the SQL Editor isn't a superuser yet — have the DB
-- owner run `ALTER ROLE postgres WITH SUPERUSER;` as supabase_admin, then retry.
-- ============================================================


-- ───────────────────────── 005: weekly_stats ─────────────────────────
CREATE TABLE IF NOT EXISTS weekly_stats (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rep_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
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

DROP POLICY IF EXISTS weekly_stats_read ON weekly_stats;
CREATE POLICY weekly_stats_read ON weekly_stats
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS weekly_stats_write ON weekly_stats;
CREATE POLICY weekly_stats_write ON weekly_stats
  FOR ALL TO authenticated
  USING      (my_role() IN ('manager','director','vp','admin'))
  WITH CHECK (my_role() IN ('manager','director','vp','admin'));


-- ───────────────────────── 006: app_settings + payment_method ─────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read ON app_settings;
CREATE POLICY app_settings_read ON app_settings
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS app_settings_write ON app_settings;
CREATE POLICY app_settings_write ON app_settings
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

DROP TRIGGER IF EXISTS app_settings_touch ON app_settings;
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE deals ADD COLUMN IF NOT EXISTS payment_method TEXT;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;

INSERT INTO app_settings (key, value) VALUES
  ('deal_statuses', '[
     {"label":"Deal Review","color":"#94a3b8"},
     {"label":"Pending Install","color":"#2dd4bf"},
     {"label":"Pay Finalized","color":"#22d3ee"},
     {"label":"Paid","color":"#4ade80"},
     {"label":"Sales Issue","color":"#f87171"}
   ]'::jsonb),
  ('payment_methods', '["Self-Pay","Goodleap","Sunlight","Self-Pay + Sunlight","Self-Pay + Goodleap"]'::jsonb),
  ('offices', '["Phoenix","Tucson"]'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ───────────────────────── 007: pay_date backfill ─────────────────────────
UPDATE deals
SET pay_date = (date_trunc('week', install_date)::date + 11)
WHERE install_date IS NOT NULL
  AND pay_date IS NULL;


-- ───────────────────────── 008: deals.checklist ─────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS checklist JSONB;


-- ───────────────────────── VP delete policy ─────────────────────────
-- Let VPs (and admins) delete deals; previously admin-only.
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals
  FOR DELETE TO authenticated
  USING (my_role() IN ('vp','admin'));


-- ───────────────────────── Verify (optional) ─────────────────────────
-- SELECT to_regclass('public.app_settings'), to_regclass('public.weekly_stats');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='deals' AND column_name IN ('payment_method','checklist');
-- SELECT count(*) AS deals_with_pay_date FROM deals WHERE pay_date IS NOT NULL;
