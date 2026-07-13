-- 035: A locked pay run still lets its deals be MARKED PAID.
--
-- Locking a run before pay day froze its finalized deals so hard that the
-- sync's PAID pass (Pay Finalized → Paid once the pay date arrives) was
-- rejected too — last week's locked run never flipped to Paid. That
-- transition doesn't change the payout at all; it only acknowledges the
-- money went out. The guard now allows an UPDATE on a locked run when the
-- ONLY change is status 'Pay Finalized' → 'Paid' (every other column
-- identical, pay date included). Everything else stays frozen. Idempotent.

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

  -- The one allowed change on a locked run: acknowledging the payout.
  -- Pay Finalized → Paid with every other column untouched (updated_at is
  -- stamped by a later trigger, so it's excluded from the comparison).
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'Pay Finalized' AND NEW.status = 'Paid'
     AND (to_jsonb(OLD) - 'status' - 'updated_at') = (to_jsonb(NEW) - 'status' - 'updated_at') THEN
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
