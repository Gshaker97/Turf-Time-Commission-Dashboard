-- 033: One deal per ArcSite project — clean up sync-created clones and make
-- duplicates impossible at the database level.
--
-- Overlapping sync runs (Apps Script starts a second schSync while a slow one
-- is still running) each fetched the deal list before the other's insert
-- landed, so a brand-new job could be created once per overlapping run
-- (real incident: Luis Gonzalez × 8, identical rows). The sync now takes a
-- script lock and pages its deal fetch, and this migration adds the backstop:
-- a partial unique index on project_id, so even a buggy writer gets a
-- constraint error instead of a duplicate deal. Hand-entered deals with no
-- project_id (NULL) are unaffected.
--
-- Step 1 deletes the existing clones CONSERVATIVELY: same project_id AND same
-- customer name, keeping the earliest-created row; gold-checked (verified)
-- copies are never deleted. Child rows (payments/history/notes) cascade.
-- Idempotent: safe to re-run.

DELETE FROM deals d
USING deals k
WHERE d.project_id IS NOT NULL AND d.project_id <> ''
  AND d.project_id = k.project_id
  AND d.deal_name  = k.deal_name
  AND d.id <> k.id
  AND d.commission_verified IS NOT TRUE
  AND (k.created_at, k.id) < (d.created_at, d.id);

-- Backstop: no two deals may share a project_id. NULL *and* empty-string ids
-- are excluded — hand-entered deals have no ArcSite project and often carry
-- '' rather than NULL; they must never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS deals_project_id_unique
  ON deals (project_id) WHERE project_id IS NOT NULL AND project_id <> '';
