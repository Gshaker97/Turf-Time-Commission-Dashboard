-- ============================================================
-- 057_lock_override.sql — an ADMIN can force an edit onto a locked pay run.
-- ------------------------------------------------------------
-- The case (per Keaton): a Paid, gold-checked deal came back into Needs
-- review because the sheet changed and the sync stamped a change_alert
-- (migration 039 lets that one write through a lock on purpose). He then
-- could not fix the deal, because `guard_locked_payroll()` rejects every
-- other write to a finalized deal on a locked run. Unlocking the whole run
-- to correct one field is the wrong tool: it unfreezes nineteen other
-- payouts, and the auto-lock grace map then re-arms on a 24h timer.
--
-- So: a NARROW, LOGGED escape hatch. Not a weakening of the lock —
--   • Only `my_role() = 'admin'` may call it (checked inside the function,
--     not by RLS, so it holds for raw PostgREST calls too).
--   • A REASON is required. An override with no reason is rejected.
--   • Every override writes a `payroll_lock_overrides` row: who, which deal,
--     which pay date, the reason, and the exact patch. The pay run's own
--     snapshot (taken at lock time, migration 028) still shows what the
--     totals were BEFORE, so the two together say what changed and why.
--   • The bypass is a TRANSACTION-LOCAL flag holding the ID OF THE ONE DEAL
--     being overridden, set immediately before that UPDATE and cleared after.
--     It cannot leak to another statement, another row or another session, and
--     PostgREST gives a client no way to set a GUC, so neither the app nor the
--     Apps Script sync can reach it. It is NOT a defence against a raw SQL
--     session — anyone who can run `SET` can also DISABLE TRIGGER — and it was
--     never meant to be: the lock protects the app, the sync and PostgREST.
--   • `deal_history` (019) logs the resulting diff as it does every edit.
--
-- Idempotent: safe to re-run.
-- ============================================================

SET search_path TO public;

-- ── The audit trail ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_lock_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  pay_date   DATE,
  profile_id UUID REFERENCES public.profiles(id),
  reason     TEXT NOT NULL,
  patch      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_lock_overrides_pay_date_idx
  ON public.payroll_lock_overrides (pay_date, created_at DESC);
CREATE INDEX IF NOT EXISTS payroll_lock_overrides_deal_idx
  ON public.payroll_lock_overrides (deal_id, created_at DESC);

ALTER TABLE public.payroll_lock_overrides ENABLE ROW LEVEL SECURITY;
-- Read-only for clients; the SECURITY DEFINER function below is the only
-- writer, exactly like deal_history.
DROP POLICY IF EXISTS payroll_lock_overrides_read ON public.payroll_lock_overrides;
CREATE POLICY payroll_lock_overrides_read ON public.payroll_lock_overrides
  FOR SELECT USING (true);

COMMENT ON TABLE public.payroll_lock_overrides IS
  'One row per admin override of a locked pay run (migration 057). Append-only: written only by override_locked_deal(), which is the only way to bypass guard_locked_payroll().';

-- ── The guard, with the escape hatch ────────────────────────
-- Builds on 028 → 034 → 035 → 039 → 056. The ONLY change here is the first
-- block: a transaction-local flag that override_locked_deal() sets.
CREATE OR REPLACE FUNCTION guard_locked_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  finalized CONSTANT TEXT[] := ARRAY['Pay Finalized', 'Paid'];
BEGIN
  -- ADMIN OVERRIDE (057). Set only inside override_locked_deal(), only after
  -- it has checked the caller is an admin and logged the reason, and only
  -- for the life of that one transaction.
  -- Scoped to one row: the flag must name THIS deal, so even a stray value
  -- cannot wave a second write through.
  IF TG_TABLE_NAME = 'deals'
     AND current_setting('app.lock_override', true) IS NOT NULL
     AND current_setting('app.lock_override', true) <> ''
     AND current_setting('app.lock_override', true)
         = (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::text THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Adjustments are always part of the payout — fully frozen on a locked run.
  IF TG_TABLE_NAME = 'payroll_adjustments' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pay_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = OLD.pay_date) THEN
      RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', OLD.pay_date;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pay_date IS NOT NULL
       AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = NEW.pay_date) THEN
      RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', NEW.pay_date;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Allowed on a locked run #1: acknowledging the payout.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'Pay Finalized' AND NEW.status = 'Paid'
     AND (to_jsonb(OLD) - 'status' - 'updated_at') = (to_jsonb(NEW) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Allowed on a locked run #2/#3: the sheet-change alert lifecycle and the
  -- competition-exclusion flag. Both are informational as far as the payout
  -- is concerned — permitted as long as nothing else on the deal changes.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'change_alert' - 'synced_baseline' - 'synced_job_price'
            - 'comp_excluded' - 'comp_excluded_at' - 'comp_excluded_by' - 'comp_excluded_note'
            - 'updated_at')
       = (to_jsonb(NEW) - 'change_alert' - 'synced_baseline' - 'synced_job_price'
            - 'comp_excluded' - 'comp_excluded_at' - 'comp_excluded_by' - 'comp_excluded_note'
            - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Deals: freeze only the locked run's PAYOUT (finalized/paid deals)...
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pay_date IS NOT NULL
     AND OLD.status = ANY (finalized)
     AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = OLD.pay_date) THEN
    RAISE EXCEPTION 'Pay run % is locked — unlock it on the Payroll page first', OLD.pay_date;
  END IF;
  -- ...and never let a deal become part of it (no finalizing onto a locked run).
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pay_date IS NOT NULL
     AND NEW.status = ANY (finalized)
     AND EXISTS (SELECT 1 FROM payroll_locks WHERE pay_date = NEW.pay_date) THEN
    RAISE EXCEPTION 'Pay run % is locked — a deal cannot be finalized onto it; unlock it on the Payroll page first', NEW.pay_date;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ── The override itself ─────────────────────────────────────
-- Applies `p_patch` (a {column: value} object) to one deal, bypassing the
-- lock. Column names are validated against deals' REAL columns and an
-- explicit blocklist, then interpolated as identifiers only — values are
-- typed by jsonb_populate_record, never concatenated — so a patch cannot
-- inject SQL or rewrite a deal's identity.
CREATE OR REPLACE FUNCTION override_locked_deal(
  p_deal_id UUID,
  p_patch   JSONB,
  p_reason  TEXT
) RETURNS public.deals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  blocked CONSTANT TEXT[] := ARRAY['id', 'created_at', 'updated_at'];
  k        TEXT;
  set_list TEXT;
  before   public.deals;
  result   public.deals;
  me       UUID;
BEGIN
  IF my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can override a locked pay run' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'An override needs a reason — it is recorded against the pay run';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to change';
  END IF;

  SELECT * INTO before FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal % not found', p_deal_id; END IF;

  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k = ANY (blocked) THEN
      RAISE EXCEPTION 'Column "%" cannot be changed by an override', k;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = k
    ) THEN
      RAISE EXCEPTION 'Unknown column "%"', k;
    END IF;
  END LOOP;

  SELECT string_agg(format('%I = n.%I', key, key), ', ')
    INTO set_list
    FROM jsonb_object_keys(p_patch) AS key;

  -- Transaction-local AND row-scoped: it names the one deal it authorises,
  -- and is gone the moment this transaction ends.
  PERFORM set_config('app.lock_override', p_deal_id::text, true);

  EXECUTE format(
    'UPDATE public.deals d SET %s
       FROM (SELECT (jsonb_populate_record(NULL::public.deals, $1)).*) n
      WHERE d.id = $2
      RETURNING d.*', set_list)
    USING p_patch, p_deal_id
     INTO result;

  PERFORM set_config('app.lock_override', '', true);

  SELECT id INTO me FROM public.profiles WHERE auth_id = auth.uid();
  INSERT INTO public.payroll_lock_overrides (deal_id, pay_date, profile_id, reason, patch)
  VALUES (p_deal_id, COALESCE(before.pay_date, result.pay_date), me, btrim(p_reason), p_patch);

  RETURN result;
END;
$$;

-- Same grant shape as 045's team_month_summary RPC. No REVOKE FROM PUBLIC:
-- the admin check INSIDE the function is the gate (anon reaching it just gets
-- the 42501), and revoking from PUBLIC risks cutting off the service role.
GRANT EXECUTE ON FUNCTION override_locked_deal(UUID, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION override_locked_deal(UUID, JSONB, TEXT) IS
  'Admin-only, reason-required, fully logged edit of a deal on a LOCKED pay run (migration 057). The only path that bypasses guard_locked_payroll().';

NOTIFY pgrst, 'reload schema';

-- Every override ever made:
--   SELECT o.created_at, p.name, d.deal_name, o.pay_date, o.reason, o.patch
--     FROM payroll_lock_overrides o
--     LEFT JOIN profiles p ON p.id = o.profile_id
--     LEFT JOIN deals d    ON d.id = o.deal_id
--    ORDER BY o.created_at DESC;
