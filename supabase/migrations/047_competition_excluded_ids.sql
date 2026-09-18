-- 047: Per-rep-AVERAGE team competitions can leave people out.
-- competitions.excluded_ids = jsonb array of profile ids. For type 'team_avg'
-- (a team's metric ÷ its rep count) these people are removed from BOTH sides
-- of the average — their deals don't count for the team and they don't count
-- as a rep — so a part-timer can be pulled from a contest without warping it
-- (per Keaton). Ignored by every other competition type.
-- Same shape/guard as `sides` and `rounds` (038): read as `comp.excluded_ids || []`.
-- Idempotent: safe to re-run.

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS excluded_ids JSONB DEFAULT '[]'::jsonb;
NOTIFY pgrst, 'reload schema';
