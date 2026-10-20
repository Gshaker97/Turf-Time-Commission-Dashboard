-- ============================================================
-- 059_move_dissolves_team.sql — moving a TEAM LEAD dissolves their team.
-- ------------------------------------------------------------
-- The case: Danny Jones led "Backyard Buccaneers" and was moved to Jared's
-- team by a scheduled move. It ran, his `manager_id` changed — and the chart
-- showed nothing, because headship comes from ROLE, not from who you report
-- to (`headIdSet`: `if (u.role === 'manager')`). He stayed a manager, so he
-- kept his own column and was filtered out of Jared's member list. The move
-- landed in the data and vanished from the screen.
--
-- That is why dragging a card refuses leads. The Move-people modal (058) let
-- you pick one anyway and said nothing about it, so the fix is to make the
-- move and the demotion ONE action:
--   • `move_team_members(..., p_demote => true)` sets role = 'rep' in the
--     SAME UPDATE as manager_id, so one trigger fire writes one log row.
--   • A FUTURE-dated move carries the demotion on its pending row
--     (`demote_to_rep`) and applies it ON THE DAY. Demoting immediately for a
--     move scheduled three weeks out would reorganise the chart three weeks
--     early — the same class of bug as stamping a move "now" instead of on
--     its effective date, which is what 058 existed to fix.
--
-- Per Keaton, there is NO "keep them leading it, just under a new director"
-- option here: that is a plain reports-to edit and the Edit form already does
-- it. Picking a lead in the move modal means they become a rep.
--
-- WHAT IS DELIBERATELY NOT TRACKED: role changes are not date-logged, and
-- this does not change that. Reports-to history is replayable (team_changes);
-- headship is not. Attribution still holds — once the lead is a rep,
-- `teamOfSale` routes their old deals to their historical team key, which is
-- the dissolved-team path, and `teamLabel` keeps reading `team_name` off
-- their profile so the old team keeps its NAME in every report. What is lost
-- is only the answer to "when did they stop being a manager".
--
-- Idempotent: safe to re-run.
-- ============================================================

SET search_path TO public;

ALTER TABLE public.pending_team_moves
  ADD COLUMN IF NOT EXISTS demote_to_rep BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.pending_team_moves.demote_to_rep IS
  'This scheduled move also makes the person a rep, dissolving the team they lead (migration 059). Applied on the effective date, never before it.';

-- A DEFAULTED parameter creates an OVERLOAD rather than replacing the
-- function, and PostgREST cannot choose between two candidates for a 4-key
-- call. Drop the 058 signature so exactly one remains.
DROP FUNCTION IF EXISTS move_team_members(UUID[], UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION move_team_members(
  p_profile_ids    UUID[],
  p_new_manager_id UUID,
  p_effective      DATE,
  p_note           TEXT    DEFAULT NULL,
  p_demote         BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  eff       DATE := COALESCE(p_effective, tt_today());
  future    BOOLEAN;
  me        UUID;
  pid       UUID;
  applied   INT := 0;
  scheduled INT := 0;
  skipped   INT := 0;
  demoted   INT := 0;
  cur       UUID;
  cur_role  TEXT;
BEGIN
  PERFORM tt_require_team_admin();
  IF p_profile_ids IS NULL OR array_length(p_profile_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nobody to move';
  END IF;
  IF p_new_manager_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_new_manager_id) THEN
    RAISE EXCEPTION 'That team lead is not on the roster';
  END IF;
  IF p_new_manager_id = ANY (p_profile_ids) THEN
    RAISE EXCEPTION 'Someone cannot report to themselves';
  END IF;

  future := eff > tt_today();
  SELECT id INTO me FROM profiles WHERE auth_id = auth.uid();

  FOREACH pid IN ARRAY p_profile_ids LOOP
    SELECT manager_id, role INTO cur, cur_role FROM profiles WHERE id = pid;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF future THEN
      -- Supersede any other pending move for this person: two scheduled
      -- destinations for one rep is never what was meant, and leaving both
      -- would apply them in an arbitrary order.
      UPDATE pending_team_moves
         SET canceled_at = now(), canceled_by = me
       WHERE profile_id = pid AND applied_at IS NULL AND canceled_at IS NULL;
      INSERT INTO pending_team_moves (profile_id, new_manager_id, effective_date, note, created_by, demote_to_rep)
      VALUES (pid, p_new_manager_id, eff, NULLIF(btrim(COALESCE(p_note, '')), ''), me, COALESCE(p_demote, FALSE));
      scheduled := scheduled + 1;

    -- Already on that team AND nothing left to demote. Recording a move to
    -- the team they are on would put a no-op in the attribution log and a
    -- bogus "since" date on their card. The demotion check matters: a lead
    -- who ALREADY reports to the destination still needs the role change, or
    -- "move Danny to Jared's team" would report success and leave him
    -- heading his own column — the exact bug this migration exists for.
    ELSIF cur IS NOT DISTINCT FROM p_new_manager_id
          AND NOT (COALESCE(p_demote, FALSE) AND cur_role IS DISTINCT FROM 'rep') THEN
      skipped := skipped + 1;

    ELSE
      PERFORM set_config('app.team_change_effective', eff::text, true);
      -- ONE statement for both columns: the log trigger fires on manager_id,
      -- so splitting this in two would either write two rows or (when only
      -- the role changes) write none and leave the two out of step.
      UPDATE profiles
         SET manager_id = p_new_manager_id,
             role = CASE WHEN COALESCE(p_demote, FALSE) THEN 'rep' ELSE role END
       WHERE id = pid;
      PERFORM set_config('app.team_change_effective', '', true);
      IF COALESCE(p_demote, FALSE) AND cur_role IS DISTINCT FROM 'rep' THEN
        demoted := demoted + 1;
      END IF;
      IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN
        UPDATE team_changes SET note = btrim(p_note)
         WHERE id = (SELECT id FROM team_changes WHERE profile_id = pid
                      ORDER BY changed_at DESC LIMIT 1);
      END IF;
      -- A role-only change (already on the team, still a manager) writes no
      -- team_changes row, so it is not counted as a move — but it DID happen,
      -- and `demoted` is what says so.
      IF cur IS DISTINCT FROM p_new_manager_id THEN
        applied := applied + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', applied, 'scheduled', scheduled, 'skipped', skipped,
    'demoted', demoted, 'effective_date', eff, 'future', future
  );
END;
$$;

-- ── Applying a scheduled move, now carrying the demotion ────
CREATE OR REPLACE FUNCTION apply_due_team_moves()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        RECORD;
  applied  INT := 0;
  demoted  INT := 0;
  cur      UUID;
  cur_role TEXT;
BEGIN
  PERFORM tt_require_team_admin();
  FOR r IN
    SELECT * FROM pending_team_moves
     WHERE applied_at IS NULL AND canceled_at IS NULL AND effective_date <= tt_today()
     ORDER BY effective_date, created_at
  LOOP
    SELECT manager_id, role INTO cur, cur_role FROM profiles WHERE id = r.profile_id;
    IF FOUND AND (cur IS DISTINCT FROM r.new_manager_id
                  OR (r.demote_to_rep AND cur_role IS DISTINCT FROM 'rep')) THEN
      -- The log must read as though the move happened on its own day, and
      -- must credit whoever SCHEDULED it rather than whoever (or whatever)
      -- happened to run this sweep.
      PERFORM set_config('app.team_change_effective', r.effective_date::text, true);
      PERFORM set_config('app.team_change_by', COALESCE(r.created_by::text, ''), true);
      UPDATE profiles
         SET manager_id = r.new_manager_id,
             role = CASE WHEN r.demote_to_rep THEN 'rep' ELSE role END
       WHERE id = r.profile_id;
      PERFORM set_config('app.team_change_effective', '', true);
      PERFORM set_config('app.team_change_by', '', true);
      IF r.note IS NOT NULL THEN
        UPDATE team_changes SET note = r.note
         WHERE id = (SELECT id FROM team_changes WHERE profile_id = r.profile_id
                      ORDER BY changed_at DESC LIMIT 1);
      END IF;
      IF cur IS DISTINCT FROM r.new_manager_id THEN applied := applied + 1; END IF;
      IF r.demote_to_rep AND cur_role IS DISTINCT FROM 'rep' THEN demoted := demoted + 1; END IF;
    END IF;
    UPDATE pending_team_moves SET applied_at = now() WHERE id = r.id;
  END LOOP;
  RETURN jsonb_build_object('applied', applied, 'demoted', demoted);
END;
$$;

GRANT EXECUTE ON FUNCTION move_team_members(UUID[], UUID, DATE, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_due_team_moves()                               TO authenticated;

COMMENT ON FUNCTION move_team_members(UUID[], UUID, DATE, TEXT, BOOLEAN) IS
  'Admin-only. Moves a list of people to one lead on one effective date — applied immediately when that date is today or past, scheduled when it is future (058). With p_demote, they also become reps, dissolving any team they lead (059).';

NOTIFY pgrst, 'reload schema';

-- Sanity check — leads who are about to stop being leads:
--   SELECT p.name, p.role, n.name AS to_team, m.effective_date, m.demote_to_rep
--     FROM pending_team_moves m
--     JOIN profiles p ON p.id = m.profile_id
--     LEFT JOIN profiles n ON n.id = m.new_manager_id
--    WHERE m.applied_at IS NULL AND m.canceled_at IS NULL
--    ORDER BY m.effective_date;
