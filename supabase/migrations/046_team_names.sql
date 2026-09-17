-- 046: Official team names.
-- A team is keyed by its HEAD everywhere (teamOfSale returns the head's id), so
-- the name lives on the head's profile row and is available wherever `users` is
-- loaded — no extra fetch on any page. NULL = the default "<Head>'s Team".
-- Edited inline on Admin → People (the column banner); read through
-- teamLabel() in utils/team.js, never inline.
--
-- Deliberately NOT sales_teams.name: those are BONUS PODS (migration 045), a
-- separate model layered on top of the org chart whose lead can be a rep who
-- heads nothing here (Ricky). Two different things, two different names.
-- Idempotent: safe to re-run.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_name TEXT;
NOTIFY pgrst, 'reload schema';
