-- ============================================================
-- 058_team_moves.sql — a clean, date-effective team-move process.
-- ------------------------------------------------------------
-- The case (per Keaton): "I am shifting some teams around. The process we
-- currently have for that isnt super clean, and the data needs to follow it
-- correctly. Whenever a change is made, anything prior to that date and time
-- stay with the team they were on, but any new deals a second after that need
-- to go with the update."
--
-- The ATTRIBUTION rule already worked (029 + utils/team.js replays the log, so
-- a sale belongs to the team its owner was on as of the sale date). What did
-- not work was the PROCESS around it, in four ways — all addressed here:
--
--   1. NO EFFECTIVE DATE. The move was stamped the instant someone dragged a
--      card. Reorganising on Monday for a change that happened last Thursday
--      recorded the wrong day, and the revenue followed the wrong team. Now
--      every move carries its own `effective_date`, chosen by the admin.
--   2. NO SCHEDULING. A reorg that starts Nov 1 had to be done ON Nov 1 or
--      backdated afterwards. `pending_team_moves` holds a future move; the
--      roster keeps working as-is and flips itself over on the day.
--   3. NO WAY TO FIX A MISTAKE. The log was append-only and read-only to the
--      app, so a mis-dated move was permanent and the only remedy was another
--      move stacked on top. Admins can now correct a date or remove an entry.
--   4. ONE PERSON AT A TIME. `move_team_members()` takes a list.
--
-- THE GRANULARITY IS A CALENDAR DAY, NOT A SECOND, and that is a hard limit of
-- the data, not a shortcut: `deals.sale_date` is a DATE column fed from the
-- ArcSite sheet's approved date, which has never carried a clock time. There
-- is no afternoon to separate from a morning. Choosing the effective date is
-- what makes the boundary exact instead of "whenever I happened to click".
--
-- WHY `effective_date` IS ITS OWN COLUMN rather than editing `changed_at`:
-- the two answer different questions. `changed_at` is WHEN THE RECORD WAS MADE
-- (audit — a backdated move must not pretend it was recorded last Thursday);
-- `effective_date` is WHEN IT COUNTS FROM (attribution). Conflating them would
-- mean every correction quietly rewrote the audit trail too.
--
-- Idempotent: safe to re-run.
-- ============================================================

SET search_path TO public;

-- ── 1. The effective date, plus an audit of corrections ─────
ALTER TABLE public.team_changes ADD COLUMN IF NOT EXISTS effective_date  DATE;
ALTER TABLE public.team_changes ADD COLUMN IF NOT EXISTS note            TEXT;
ALTER TABLE public.team_changes ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ;
ALTER TABLE public.team_changes ADD COLUMN IF NOT EXISTS edited_by       UUID;
ALTER TABLE public.team_changes ADD COLUMN IF NOT EXISTS prior_effective DATE;

COMMENT ON COLUMN public.team_changes.effective_date IS
  'The calendar day this move counts from: deals on/after it belong to the new team, deals before it to the old one. NULL only on pre-058 rows, where the reader falls back to changed_at. Distinct from changed_at, which is when the record was made.';
COMMENT ON COLUMN public.team_changes.prior_effective IS
  'What effective_date was before an admin corrected it (058). NULL = never corrected.';

CREATE INDEX IF NOT EXISTS team_changes_profile_effective_idx
  ON public.team_changes (profile_id, effective_date, changed_at);

-- Backfill: the ARIZONA calendar day of every existing row. This is exactly
-- what the frontend already derived from changed_at for a viewer in Arizona
-- (utils/team.js localDay), so no existing attribution moves. For a viewer in
-- another timezone it is a fix — the company's day is Arizona's, not the
-- browser's.
UPDATE public.team_changes
   SET effective_date = (changed_at AT TIME ZONE 'America/Phoenix')::date
 WHERE effective_date IS NULL AND changed_at IS NOT NULL;

-- ── 2. The trigger, now honouring an effective date ─────────
-- Three transaction-local GUCs, every one of them set ONLY inside the
-- SECURITY DEFINER functions below and only after they have checked the
-- caller is an admin. PostgREST gives a client no way to set a GUC, so
-- neither the app nor the Apps Script sync can reach them:
--   app.team_change_effective — the day the move counts from
--   app.team_change_by        — who ordered it (for a scheduled move applied
--                               later by the server, this is the SCHEDULER,
--                               not whoever happened to trigger the apply)
--   app.team_change_silent    — the profile id whose change must NOT be
--                               logged, used when an admin UNDOES a move:
--                               putting the old lead back writes no second
--                               entry, because the undo deletes the first.
-- NOTE the explicit `SET search_path = public`: CREATE OR REPLACE drops the
-- settings an ALTER FUNCTION added, and migration 036 pinned this very
-- function because GoTrue's connection runs with search_path = auth.
CREATE OR REPLACE FUNCTION log_team_change()
RETURNS TRIGGER SECURITY DEFINER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  eff    TEXT := COALESCE(current_setting('app.team_change_effective', true), '');
  actor  TEXT := COALESCE(current_setting('app.team_change_by', true), '');
  silent TEXT := COALESCE(current_setting('app.team_change_silent', true), '');
BEGIN
  IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    -- Row-scoped, like 057's lock override: the flag must name THIS profile,
    -- so a stray value cannot silence a second person's move.
    IF silent = NEW.id::text THEN
      RETURN NEW;
    END IF;
    INSERT INTO team_changes (profile_id, old_manager_id, new_manager_id, changed_by, effective_date)
    VALUES (
      NEW.id, OLD.manager_id, NEW.manager_id,
      CASE WHEN actor = '' THEN my_profile_id() ELSE actor::uuid END,
      CASE WHEN eff = '' THEN (now() AT TIME ZONE 'America/Phoenix')::date ELSE eff::date END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_team_change ON profiles;
CREATE TRIGGER profiles_team_change
  AFTER UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_team_change();

-- ── 3. Scheduled (future-dated) moves ───────────────────────
-- A move dated ahead does NOT touch profiles.manager_id and does NOT affect
-- attribution: until it is applied it has not happened. On its day,
-- apply_due_team_moves() performs the real move with effective_date set to
-- the scheduled day, so the log reads exactly as if it had been done then.
CREATE TABLE IF NOT EXISTS public.pending_team_moves (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  new_manager_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  note           TEXT,
  created_by     UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ,
  canceled_at    TIMESTAMPTZ,
  canceled_by    UUID REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS pending_team_moves_due_idx
  ON public.pending_team_moves (effective_date)
  WHERE applied_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS pending_team_moves_profile_idx
  ON public.pending_team_moves (profile_id, effective_date);

ALTER TABLE public.pending_team_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_team_moves_read ON public.pending_team_moves;
CREATE POLICY pending_team_moves_read ON public.pending_team_moves
  FOR SELECT USING (true);
-- No client write policies: the functions below are the only writers, exactly
-- like team_changes itself.

COMMENT ON TABLE public.pending_team_moves IS
  'Team moves dated in the FUTURE (migration 058). Until applied they change nothing — not the roster, not attribution. apply_due_team_moves() performs them on their effective date.';

-- ── 4. Helpers ──────────────────────────────────────────────
-- Today in the company's timezone. Arizona never observes DST, so this is a
-- stable UTC-7 and the one definition of "today" for a move.
CREATE OR REPLACE FUNCTION tt_today()
RETURNS DATE LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'America/Phoenix')::date;
$$;

-- Admin-or-trusted-backend, the same test migration 032 settled on for
-- profile writes: anonymous API traffic cannot reach these functions (they
-- are granted to `authenticated`), so auth.uid() IS NULL here means the
-- service key or an operator in Studio.
CREATE OR REPLACE FUNCTION tt_require_team_admin()
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can change team assignments' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Put a profile's reports-to back in step with its own log after an entry was
-- corrected or removed: the roster should always equal the LATEST remaining
-- entry. Written silently — re-deriving the current state is not itself a
-- team change and must not add a row.
-- Ordered by (effective_date, changed_at) because a correction can reorder
-- the log: backdating the second of two moves makes the FIRST one latest.
CREATE OR REPLACE FUNCTION tt_resync_profile_manager(p_profile_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  want UUID;
  have UUID;
BEGIN
  -- `want` may legitimately be NULL (the latest move was to Unassigned), so
  -- FOUND — not the value — is what says whether an entry exists.
  SELECT c.new_manager_id INTO want
    FROM team_changes c
   WHERE c.profile_id = p_profile_id
   ORDER BY COALESCE(c.effective_date, (c.changed_at AT TIME ZONE 'America/Phoenix')::date) DESC,
            c.changed_at DESC
   LIMIT 1;
  -- No entries left — we cannot know what the roster should say, so leave it.
  IF NOT FOUND THEN RETURN; END IF;

  SELECT manager_id INTO have FROM profiles WHERE id = p_profile_id;
  IF want IS NOT DISTINCT FROM have THEN RETURN; END IF;

  PERFORM set_config('app.team_change_silent', p_profile_id::text, true);
  UPDATE profiles SET manager_id = want WHERE id = p_profile_id;
  PERFORM set_config('app.team_change_silent', '', true);
END;
$$;

-- ── 5. Making a move ────────────────────────────────────────
-- One call moves a LIST of people to one lead, effective on one day. A date
-- today or in the past is applied immediately (and backdated in the log); a
-- future date is scheduled.
-- Returns { applied, scheduled, skipped, effective_date, future } so the UI
-- can say what actually happened rather than guessing from the date.
CREATE OR REPLACE FUNCTION move_team_members(
  p_profile_ids    UUID[],
  p_new_manager_id UUID,
  p_effective      DATE,
  p_note           TEXT DEFAULT NULL
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
  cur       UUID;
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
    SELECT manager_id INTO cur FROM profiles WHERE id = pid;
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
      INSERT INTO pending_team_moves (profile_id, new_manager_id, effective_date, note, created_by)
      VALUES (pid, p_new_manager_id, eff, NULLIF(btrim(COALESCE(p_note, '')), ''), me);
      scheduled := scheduled + 1;
    ELSIF cur IS NOT DISTINCT FROM p_new_manager_id THEN
      -- Already there. Recording a move to the team they are on would put a
      -- no-op in the attribution log and a bogus "since" date on their card.
      skipped := skipped + 1;
    ELSE
      PERFORM set_config('app.team_change_effective', eff::text, true);
      UPDATE profiles SET manager_id = p_new_manager_id WHERE id = pid;
      PERFORM set_config('app.team_change_effective', '', true);
      IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN
        UPDATE team_changes SET note = btrim(p_note)
         WHERE id = (SELECT id FROM team_changes WHERE profile_id = pid
                      ORDER BY changed_at DESC LIMIT 1);
      END IF;
      applied := applied + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', applied, 'scheduled', scheduled, 'skipped', skipped,
    'effective_date', eff, 'future', future
  );
END;
$$;

-- ── 6. Applying what has come due ───────────────────────────
-- Called by the site server on a timer AND by Admin → People on load, so a
-- scheduled move lands even if one of the two is down. Idempotent: a row is
-- stamped applied_at inside the same statement that moves the person.
CREATE OR REPLACE FUNCTION apply_due_team_moves()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       RECORD;
  applied INT := 0;
  cur     UUID;
BEGIN
  PERFORM tt_require_team_admin();
  FOR r IN
    SELECT * FROM pending_team_moves
     WHERE applied_at IS NULL AND canceled_at IS NULL AND effective_date <= tt_today()
     ORDER BY effective_date, created_at
  LOOP
    SELECT manager_id INTO cur FROM profiles WHERE id = r.profile_id;
    IF FOUND AND cur IS DISTINCT FROM r.new_manager_id THEN
      -- The log must read as though the move happened on its own day, and
      -- must credit whoever SCHEDULED it rather than whoever (or whatever)
      -- happened to run this sweep.
      PERFORM set_config('app.team_change_effective', r.effective_date::text, true);
      PERFORM set_config('app.team_change_by', COALESCE(r.created_by::text, ''), true);
      UPDATE profiles SET manager_id = r.new_manager_id WHERE id = r.profile_id;
      PERFORM set_config('app.team_change_effective', '', true);
      PERFORM set_config('app.team_change_by', '', true);
      IF r.note IS NOT NULL THEN
        UPDATE team_changes SET note = r.note
         WHERE id = (SELECT id FROM team_changes WHERE profile_id = r.profile_id
                      ORDER BY changed_at DESC LIMIT 1);
      END IF;
      applied := applied + 1;
    END IF;
    UPDATE pending_team_moves SET applied_at = now() WHERE id = r.id;
  END LOOP;
  RETURN jsonb_build_object('applied', applied);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_pending_team_move(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID;
BEGIN
  PERFORM tt_require_team_admin();
  SELECT id INTO me FROM profiles WHERE auth_id = auth.uid();
  UPDATE pending_team_moves
     SET canceled_at = now(), canceled_by = me
   WHERE id = p_id AND applied_at IS NULL AND canceled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That scheduled move has already been applied or canceled';
  END IF;
END;
$$;

-- ── 7. Correcting the log ───────────────────────────────────
-- Changing an effective date rewrites team attribution on purpose: every team
-- figure either side of that day shifts. The UI states how many deals change
-- hands before committing.
CREATE OR REPLACE FUNCTION set_team_change_date(p_id UUID, p_effective DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_before team_changes;
  me         UUID;
BEGIN
  PERFORM tt_require_team_admin();
  IF p_effective IS NULL THEN RAISE EXCEPTION 'A move needs an effective date'; END IF;

  SELECT * INTO row_before FROM team_changes WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That log entry no longer exists'; END IF;

  SELECT id INTO me FROM profiles WHERE auth_id = auth.uid();
  UPDATE team_changes
     SET effective_date  = p_effective,
         -- Keep the FIRST recorded value: prior_effective answers "what did
         -- this say originally", which a second correction must not erase.
         prior_effective = COALESCE(prior_effective, row_before.effective_date,
                                    (row_before.changed_at AT TIME ZONE 'America/Phoenix')::date),
         edited_at       = now(),
         edited_by       = me
   WHERE id = p_id;

  PERFORM tt_resync_profile_manager(row_before.profile_id);
END;
$$;

-- Remove an entry that should never have been recorded. `p_restore` also puts
-- the person's reports-to back to what the entry says it was — the "I moved
-- the wrong person" case, which is an UNDO rather than a history edit.
CREATE OR REPLACE FUNCTION delete_team_change(p_id UUID, p_restore BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_before team_changes;
  latest     UUID;
BEGIN
  PERFORM tt_require_team_admin();
  SELECT * INTO row_before FROM team_changes WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That log entry no longer exists'; END IF;

  IF p_restore THEN
    -- Restoring only makes sense on the person's LATEST entry: on an older
    -- one, old_manager_id is not where they are now, so putting it back
    -- would move them somewhere nobody asked for. Removing an older entry
    -- edits history (and resyncs from whatever remains latest) instead.
    SELECT c.id INTO latest FROM team_changes c
      WHERE c.profile_id = row_before.profile_id
      ORDER BY COALESCE(c.effective_date, (c.changed_at AT TIME ZONE 'America/Phoenix')::date) DESC,
               c.changed_at DESC
      LIMIT 1;
    IF latest IS DISTINCT FROM p_id THEN
      RAISE EXCEPTION 'Only the most recent move can be undone — this one has a later move after it';
    END IF;
  END IF;

  DELETE FROM team_changes WHERE id = p_id;

  IF p_restore THEN
    -- Silent: the undo removes the original entry, so putting the old lead
    -- back must not write a mirror-image one.
    PERFORM set_config('app.team_change_silent', row_before.profile_id::text, true);
    UPDATE profiles SET manager_id = row_before.old_manager_id WHERE id = row_before.profile_id;
    PERFORM set_config('app.team_change_silent', '', true);
  ELSE
    PERFORM tt_resync_profile_manager(row_before.profile_id);
  END IF;
END;
$$;

-- Same grant shape as 045/057: the admin check INSIDE each function is the
-- gate, so no REVOKE FROM PUBLIC (which risks cutting off the service role).
GRANT EXECUTE ON FUNCTION tt_today()                                      TO authenticated;
GRANT EXECUTE ON FUNCTION move_team_members(UUID[], UUID, DATE, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION apply_due_team_moves()                          TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_pending_team_move(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION set_team_change_date(UUID, DATE)                TO authenticated;
GRANT EXECUTE ON FUNCTION delete_team_change(UUID, BOOLEAN)               TO authenticated;

COMMENT ON FUNCTION move_team_members(UUID[], UUID, DATE, TEXT) IS
  'Admin-only. Moves a list of people to one lead on one effective date — applied immediately when that date is today or past, scheduled in pending_team_moves when it is future (migration 058).';
COMMENT ON FUNCTION apply_due_team_moves() IS
  'Performs every scheduled team move whose effective date has arrived, logging it as though it happened on that day and crediting whoever scheduled it (migration 058).';

NOTIFY pgrst, 'reload schema';

-- Sanity checks:
--   SELECT c.effective_date, c.changed_at::date AS recorded, p.name,
--          o.name AS from_lead, n.name AS to_lead, c.prior_effective
--     FROM team_changes c
--     JOIN profiles p ON p.id = c.profile_id
--     LEFT JOIN profiles o ON o.id = c.old_manager_id
--     LEFT JOIN profiles n ON n.id = c.new_manager_id
--    ORDER BY c.effective_date DESC;
--
--   SELECT p.name, n.name AS to_lead, m.effective_date, m.applied_at, m.canceled_at
--     FROM pending_team_moves m
--     JOIN profiles p ON p.id = m.profile_id
--     LEFT JOIN profiles n ON n.id = m.new_manager_id
--    ORDER BY m.effective_date;
