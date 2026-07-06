-- 030: Override exclusions — subcontracted line items (e.g. Electrical, Gas,
-- Pergolas) whose price does NOT earn manager/director/VP override. Stored per
-- deal as a jsonb array of { item, amount }. Baseline and job price stay
-- untouched; the commission engine computes overrides off
-- (baseline − sum of exclusions). The selectable item list is admin-editable
-- in app_settings.override_exclusion_items. Idempotent: safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS override_exclusions JSONB;
