-- ============================================================
-- 006_settings.sql — admin-editable site configuration
-- ------------------------------------------------------------
-- Adds:
--   • app_settings: key→jsonb config the Admin → Settings tab edits live
--     (deal statuses, payment methods, offices).
--   • deals.payment_method column.
--   • Relaxes the hard-coded deals.status CHECK so admins can add/rename
--     statuses from the UI (validation now lives in the app).
--
-- Idempotent — safe on a fresh OR already-deployed database. Depends on
-- touch_updated_at() (001) and my_role() (002).
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read settings (the app needs status lists etc.)
DROP POLICY IF EXISTS app_settings_read ON app_settings;
CREATE POLICY app_settings_read ON app_settings
  FOR SELECT TO authenticated USING (TRUE);

-- Only admins can change them.
DROP POLICY IF EXISTS app_settings_write ON app_settings;
CREATE POLICY app_settings_write ON app_settings
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

DROP TRIGGER IF EXISTS app_settings_touch ON app_settings;
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Payment method on deals (Self-Pay / Goodleap / Sunlight / combos…)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Statuses are now admin-editable, so drop the fixed CHECK constraint.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;

-- Seed defaults (only when not already present).
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
