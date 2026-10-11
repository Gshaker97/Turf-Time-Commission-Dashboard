-- ============================================================
-- 055_deal_audit_ghl.sql — add the 8th audit item: GHL information.
--
-- The deal audit (migration 054) checks 7 items; this adds an 8th auto item,
-- `ghl_information`, which verifies the deal's GoHighLevel contact has the sales
-- rep, install date, commission, and payment method filled in. The checklist
-- only needs the item_key CHECK widened to accept the new key — everything else
-- (RLS, history, the UNIQUE) already covers it. deal_checklist_history.item_key
-- has no CHECK, so it needs no change.
--
-- Idempotent: safe to run more than once. Apply by hand (BEGIN; / COMMIT;).
-- ============================================================

ALTER TABLE deal_checklist DROP CONSTRAINT IF EXISTS deal_checklist_item_key_check;
ALTER TABLE deal_checklist ADD  CONSTRAINT deal_checklist_item_key_check CHECK (item_key IN (
  'on_calendar','install_date','financing','setter_closer',
  'customer_info','manager_override','drawing_commission','ghl_information'));

-- Let PostgREST pick up the change.
NOTIFY pgrst, 'reload schema';
