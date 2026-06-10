-- 020: client_errors — frontend crash/error reports for the Watchdog.
-- The app's ErrorBoundary + global error handlers insert a row whenever a page
-- throws; the Watchdog (Apps Script) reads recent rows and emails a digest.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS client_errors (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  path       TEXT,                                -- route where it happened
  message    TEXT,
  stack      TEXT,
  user_agent TEXT,
  profile_id UUID REFERENCES profiles(id)         -- who hit it (if signed in)
);

CREATE INDEX IF NOT EXISTS client_errors_at_idx ON client_errors (at DESC);

ALTER TABLE client_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_errors_insert ON client_errors;
CREATE POLICY client_errors_insert ON client_errors
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS client_errors_select ON client_errors;
CREATE POLICY client_errors_select ON client_errors
  FOR SELECT TO authenticated USING (true);
-- No update/delete from clients; the Watchdog reads via service role.
