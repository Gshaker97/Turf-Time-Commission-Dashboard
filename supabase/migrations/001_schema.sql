-- ============================================================
-- 001_schema.sql — Turf Time Dashboard core schema
-- Field names match the frontend exactly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles (frontend reads from "profiles") ────────────────
CREATE TABLE profiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  role            TEXT NOT NULL
                  CHECK (role IN ('rep','manager','director','vp','admin')),
  company_name    TEXT DEFAULT 'Turf Time',
  manager_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  director_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  vp_id           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  hire_date       DATE,
  termination_date DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_manager  ON profiles(manager_id);
CREATE INDEX idx_profiles_director ON profiles(director_id);
CREATE INDEX idx_profiles_vp       ON profiles(vp_id);
CREATE INDEX idx_profiles_role     ON profiles(role);
CREATE INDEX idx_profiles_auth     ON profiles(auth_id);

-- ── Deals ────────────────────────────────────────────────────
CREATE TABLE deals (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_name              TEXT NOT NULL,
  office                 TEXT,
  project_id             TEXT,
  status                 TEXT NOT NULL DEFAULT 'Deal Review'
                         CHECK (status IN (
                           'Deal Review',
                           'Pending Install',
                           'Pay Finalized',
                           'Paid',
                           'Sales Issue'
                         )),

  -- Dates
  sale_date              DATE NOT NULL,
  install_date           DATE,
  pay_date               DATE,

  -- People on the deal
  setter_id              UUID NOT NULL REFERENCES profiles(id),
  closer_id              UUID REFERENCES profiles(id),
  manager_id             UUID REFERENCES profiles(id),
  director_id            UUID REFERENCES profiles(id),
  vp_id                  UUID REFERENCES profiles(id),

  -- Money
  baseline_revenue       NUMERIC(12,2) NOT NULL CHECK (baseline_revenue >= 0),
  job_price              NUMERIC(12,2) NOT NULL CHECK (job_price >= 0),

  -- Splits & overrides (decimals: 0.5 = 50%, 0.04 = 4%)
  setter_split_pct       NUMERIC(7,4) DEFAULT 0.5
                         CHECK (setter_split_pct BETWEEN 0 AND 1),
  manager_override_pct   NUMERIC(7,4) DEFAULT 0
                         CHECK (manager_override_pct  BETWEEN 0 AND 1),
  director_override_pct  NUMERIC(7,4) DEFAULT 0
                         CHECK (director_override_pct BETWEEN 0 AND 1),
  vp_override_pct        NUMERIC(7,4) DEFAULT 0
                         CHECK (vp_override_pct       BETWEEN 0 AND 1),
  manager_to_rep_pct     NUMERIC(7,4) DEFAULT 0
                         CHECK (manager_to_rep_pct  BETWEEN 0 AND 1),
  director_to_rep_pct    NUMERIC(7,4) DEFAULT 0
                         CHECK (director_to_rep_pct BETWEEN 0 AND 1),
  vp_to_rep_pct          NUMERIC(7,4) DEFAULT 0
                         CHECK (vp_to_rep_pct       BETWEEN 0 AND 1),

  -- Stored dollar amounts (from Google Sheet, includes manual bonuses).
  -- When set, the frontend uses these instead of computing from percentages.
  -- When NULL, the frontend falls back to calculating from the % fields above.
  setter_amount          NUMERIC(12,2) CHECK (setter_amount   IS NULL OR setter_amount   >= 0),
  closer_amount          NUMERIC(12,2) CHECK (closer_amount   IS NULL OR closer_amount   >= 0),
  manager_amount         NUMERIC(12,2) CHECK (manager_amount  IS NULL OR manager_amount  >= 0),
  director_amount        NUMERIC(12,2) CHECK (director_amount IS NULL OR director_amount >= 0),
  vp_amount              NUMERIC(12,2) CHECK (vp_amount       IS NULL OR vp_amount       >= 0),

  -- Deduction (chargeback / clawback recorded against the rep take).
  -- The stored *_amount fields above are already net of this; these two
  -- columns keep the amount + reason for the record.
  deduction_amount       NUMERIC(12,2) CHECK (deduction_amount IS NULL OR deduction_amount >= 0),
  deduction_note         TEXT,

  -- Audit
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  created_by             UUID REFERENCES profiles(id)
);

CREATE INDEX idx_deals_setter   ON deals(setter_id);
CREATE INDEX idx_deals_closer   ON deals(closer_id);
CREATE INDEX idx_deals_manager  ON deals(manager_id);
CREATE INDEX idx_deals_director ON deals(director_id);
CREATE INDEX idx_deals_vp       ON deals(vp_id);
CREATE INDEX idx_deals_sale     ON deals(sale_date);
CREATE INDEX idx_deals_install  ON deals(install_date);
CREATE INDEX idx_deals_status   ON deals(status);

-- ── Payments (frontend reads from "payments") ────────────────
CREATE TABLE payments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  pay_date    DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID REFERENCES profiles(id)
);

CREATE INDEX idx_payments_deal ON payments(deal_id);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_date ON payments(pay_date);

-- ── Monthly goals ────────────────────────────────────────────
CREATE TABLE monthly_goals (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year            INT NOT NULL,
  month           INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  baseline_target NUMERIC(12,2) NOT NULL CHECK (baseline_target >= 0),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (year, month)
);

-- ── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER deals_touch BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Auto-create profile on auth signup ───────────────────────
-- Optional convenience: when a new auth user is created in Studio,
-- this trigger inserts a matching profiles row IF one doesn't exist
-- with that email. This way you don't have to manually link auth_id.
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If a profile with this email already exists (from seed), link it
  UPDATE profiles SET auth_id = NEW.id
  WHERE lower(email) = lower(NEW.email) AND auth_id IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
