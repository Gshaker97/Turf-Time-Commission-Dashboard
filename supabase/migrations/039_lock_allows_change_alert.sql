-- 039: A locked pay run still lets its deals' CHANGE ALERTS move.
--
-- The sheet-change alert (deals.change_alert, migration 031) is purely
-- informational — it never touches the payout. But the payroll lock froze
-- finalized deals so hard that an admin couldn't DISMISS an alert on a
-- locked run (and the sync couldn't STAMP a new one, or advance its
-- synced_* sheet snapshot that fires alerts exactly once per sheet version).
--
-- The guard now allows an UPDATE on a locked deal when the ONLY changed
-- columns are change_alert / synced_baseline / synced_job_price (plus the
-- trigger-stamped updated_at). Money, status, dates, and people stay frozen.
-- Builds on 035 (which allowed Pay Finalized → Paid only). Idempotent.

CREATE OR REPLACE FUNCTION guard_locked_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  finalized CONSTANT TEXT[] := ARRAY['Pay Finalized', 'Paid'];
BEGIN
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
  -- Pay Finalized → Paid with every other column untouched (updated_at is
  -- stamped by a later trigger, so it's excluded from the comparison).
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'Pay Finalized' AND NEW.status = 'Paid'
     AND (to_jsonb(OLD) - 'status' - 'updated_at') = (to_jsonb(NEW) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  -- Allowed on a locked run #2: the sheet-change alert lifecycle. Dismissing
  -- an alert (admin) or stamping/advancing one (sync) is informational only —
  -- permitted as long as nothing else on the deal changes.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'change_alert' - 'synced_baseline' - 'synced_job_price' - 'updated_at')
       = (to_jsonb(NEW) - 'change_alert' - 'synced_baseline' - 'synced_job_price' - 'updated_at') THEN
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
