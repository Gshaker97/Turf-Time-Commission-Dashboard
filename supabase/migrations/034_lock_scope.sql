-- 034: Scope the pay-run lock to the PAYOUT, not the date.
--
-- The 028 guard froze every deal carrying a locked pay_date — including deals
-- that were pulled OFF the run before locking (real case: a Sales Issue deal
-- still wearing the 7/10 date couldn't get its install date corrected because
-- the 7/10 run was locked, even though it wasn't part of that payout at all).
--
-- New rule: the lock freezes deals that ARE the payout (status Pay Finalized /
-- Paid) and everything about adjustments. A non-finalized deal parked on a
-- locked date stays editable — but nothing can BECOME finalized on a locked
-- run, so the locked payout can never grow or change. Idempotent.

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
