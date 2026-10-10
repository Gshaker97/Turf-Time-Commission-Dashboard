-- ============================================================
-- 054_deal_audit.sql — post-sale deal audit checklist
-- ------------------------------------------------------------
-- Backs the 7-item audit on the Deals "Needs review" queue. Items that can be
-- verified against the install sheet auto-check (source 'audit'); the rest are
-- ticked by hand (source 'manual'). When all 7 are checked the deal moves to
-- status 'Deal Reviewed' and gets the gold check (commission_verified = true).
--
-- Writes to deal_checklist happen SERVER-SIDE with the service key (the audit
-- endpoints in server.js), so there are no client write policies — only a read
-- policy. The fix buttons (use-calendar-date, use-calendar-setter/closer,
-- manager backfill) write to `deals` through the site's existing admin path.
--
-- NONE of these columns/tables are read by src/utils/commission.js or any
-- payout calculation — the audit only READS the engine, never feeds it.
--
-- Idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================

-- ── Informational customer contact on the deal (item 5) ─────
-- Filled from the Jobs tab during an audit ONLY when empty; never overwritten.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS customer_address TEXT;

-- ── Current checklist state: one row per (deal, item) ───────
CREATE TABLE IF NOT EXISTS deal_checklist (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL CHECK (item_key IN (
               'on_calendar','install_date','financing','setter_closer',
               'customer_info','manager_override','drawing_commission')),
  checked    BOOLEAN NOT NULL DEFAULT FALSE,
  source     TEXT NOT NULL DEFAULT 'audit' CHECK (source IN ('audit','manual')),
  checked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- null = the audit
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note       TEXT,
  UNIQUE (deal_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_deal_checklist_deal ON deal_checklist(deal_id);

-- ── Append-only history so every change is traceable ───────
CREATE TABLE IF NOT EXISTS deal_checklist_history (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL,
  checked    BOOLEAN NOT NULL,
  source     TEXT NOT NULL,
  checked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  note       TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_checklist_history_deal ON deal_checklist_history(deal_id);

ALTER TABLE deal_checklist         ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_checklist_history ENABLE ROW LEVEL SECURITY;

-- Anyone signed in may READ the checklist (the Deals queue renders it). All
-- WRITES go through the service-key audit endpoints, which bypass RLS, so no
-- client write policy exists — a rep cannot tick items from the browser.
DROP POLICY IF EXISTS deal_checklist_read ON deal_checklist;
CREATE POLICY deal_checklist_read ON deal_checklist
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS deal_checklist_history_read ON deal_checklist_history;
CREATE POLICY deal_checklist_history_read ON deal_checklist_history
  FOR SELECT TO authenticated USING (TRUE);

-- ── Seed the 'Deal Reviewed' status, right after 'Deal Review' ──
-- Statuses live in app_settings.deal_statuses (jsonb [{label,color}]). The app
-- also carries this in its built-in default (SettingsContext), so a DB with no
-- custom row needs nothing here; this only patches an existing custom row.
DO $$
DECLARE v JSONB;
BEGIN
  SELECT value INTO v FROM app_settings WHERE key = 'deal_statuses';
  IF v IS NULL THEN RETURN; END IF;                         -- default list already has it
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e->>'label' = 'Deal Reviewed') THEN
    RETURN;                                                 -- already present
  END IF;
  -- Interleave: keep every element, and inject the new one right after the
  -- first 'Deal Review' (ordinal*2 keeps order; the injected row gets +1).
  v := (
    SELECT coalesce(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    FROM (
      SELECT e AS elem, (idx * 2)     AS ord
        FROM jsonb_array_elements(v) WITH ORDINALITY AS t(e, idx)
      UNION ALL
      SELECT '{"label":"Deal Reviewed","color":"#a78bfa"}'::jsonb, (idx * 2 + 1)
        FROM jsonb_array_elements(v) WITH ORDINALITY AS t(e, idx)
       WHERE e->>'label' = 'Deal Review'
    ) s
  );
  UPDATE app_settings SET value = v WHERE key = 'deal_statuses';
END $$;

NOTIFY pgrst, 'reload schema';
