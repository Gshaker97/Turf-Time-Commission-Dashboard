-- 028: Lock completed pay runs. Once an admin locks a pay date, the deals on
-- that run (and its manual adjustments) are frozen AT THE DATABASE level — a
-- trigger rejects updates/deletes/moves, so nothing (app, sync, SQL with the
-- service key) can silently rewrite payroll history. Unlocking (admins only)
-- removes the row and thereby the freeze. A snapshot of the payee totals is
-- stored at lock time for the record. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS payroll_locks (
  pay_date  DATE PRIMARY KEY,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  locked_by UUID,
  snapshot  JSONB
);

ALTER TABLE payroll_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_locks_read ON payroll_locks;
CREATE POLICY payroll_locks_read ON payroll_locks
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS payroll_locks_write ON payroll_locks;
CREATE POLICY payroll_locks_write ON payroll_locks
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');

-- Freeze the deals on a locked run: no edits/deletes of a deal whose pay_date
-- is locked, and no moving a deal ONTO a locked run.
CREATE OR REPLACE FUNCTION guard_locked_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
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
END;
$$;

DROP TRIGGER IF EXISTS deals_locked_payroll ON deals;
CREATE TRIGGER deals_locked_payroll
  BEFORE INSERT OR UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION guard_locked_payroll();

DROP TRIGGER IF EXISTS payroll_adjustments_locked ON payroll_adjustments;
CREATE TRIGGER payroll_adjustments_locked
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION guard_locked_payroll();
