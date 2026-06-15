-- 027: Manual payroll adjustments — a per-rep, per-pay-date +/- dollar amount
-- applied on top of their deal commissions for that pay run (e.g. a missed past
-- deduction, a correction, a one-off addition). Independent of any deal.
-- All payout math stays in src/pages/Payroll.jsx; this just stores the entries.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payee_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pay_date   DATE NOT NULL,
  amount     NUMERIC(12,2) NOT NULL,   -- positive adds, negative deducts
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS payroll_adjustments_pay_date_idx ON payroll_adjustments (pay_date);

ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read (so a rep could see their own later); only admins write.
DROP POLICY IF EXISTS payroll_adj_read ON payroll_adjustments;
CREATE POLICY payroll_adj_read ON payroll_adjustments
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS payroll_adj_write ON payroll_adjustments;
CREATE POLICY payroll_adj_write ON payroll_adjustments
  FOR ALL TO authenticated
  USING (my_role() = 'admin') WITH CHECK (my_role() = 'admin');
