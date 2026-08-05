-- 038: Competition squads + rounds.
--
--   sides  JSONB — for type='squads' ("Grouped Teams"): named sides, each any
--          mix of whole teams and individual reps.
--            [{ "id": "s1", "name": "Phoenix Alliance",
--               "team_ids": ["<lead profile id>", ...],
--               "rep_ids":  ["<profile id>", ...] }]
--          Team membership resolves DATE-EFFECTIVELY at scoring time (a deal
--          counts for the side its owner's team owned on the sale date), so a
--          mid-competition roster move never swings a contest retroactively.
--
--   rounds JSONB — optional rounds on ANY competition type: each with its own
--          date window and prize; every round is a fresh race (scores reset),
--          with overall standings across the whole span shown alongside.
--            [{ "id": "r1", "name": "Round 1", "start": "2026-08-02",
--               "end": "2026-08-08", "prize": "$250 + steak dinner",
--               "winner_id": null }]
--          winner_id null = auto (top of that round's standings once it ends);
--          set = admin override (ties, adjustments).
--
-- Scoring stays fully frontend (src/utils/competition.js). Idempotent.

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS sides  JSONB DEFAULT '[]'::jsonb;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS rounds JSONB DEFAULT '[]'::jsonb;
