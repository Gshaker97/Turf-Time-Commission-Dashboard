-- ============================================================
-- 014_deal_notes.sql — free-text notes per deal
-- ------------------------------------------------------------
-- Adds deals.notes (text) backing the collapsible notes box on the Deals page.
-- Idempotent.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS notes TEXT;
