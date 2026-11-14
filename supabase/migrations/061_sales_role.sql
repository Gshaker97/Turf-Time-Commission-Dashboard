-- ============================================================
-- 061_sales_role.sql — who SETS and who CLOSES, on the person.
-- ------------------------------------------------------------
-- Until now setter/closer existed only per deal (deals.setter_id /
-- deals.closer_id). Nothing said what a rep's job IS, so the leaderboard,
-- the Admin roster and My Card could not tell a setter having a normal month
-- from a closer having a bad one. Garrison asked for it (Nov 14 2026) and
-- gave the roster by hand, below.
--
-- One nullable text column: 'setter' | 'closer' | 'both'. NULL means "not
-- set" and is shown as nothing — never defaulted, never guessed from deals.
-- Display and filtering only: no commission, override, payroll or permission
-- logic reads this column.
--
-- The seed matches on the exact display name as it appears on the Admin
-- People page today and only fills rows that are still NULL, so re-running
-- is harmless and a value an admin has since changed is never overwritten.
-- Leadership is left NULL except Garrison, who sells occasionally.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sales_role TEXT
  CHECK (sales_role IS NULL OR sales_role IN ('setter', 'closer', 'both'));

COMMENT ON COLUMN profiles.sales_role IS
  'setter | closer | both | NULL (unset). Display/filter only; per-deal credit stays on deals.setter_id / closer_id.';

UPDATE profiles SET sales_role = 'closer'
 WHERE sales_role IS NULL AND name IN (
  'Conner Ipsen', 'Ricky Marrugo', 'Jared Aguilar', 'Jordan Bagwell');

UPDATE profiles SET sales_role = 'both'
 WHERE sales_role IS NULL AND name IN (
  'Casey Lederman', 'JC Correa', 'Danny Jones', 'Andrew Sipila', 'Colt Niznik',
  'Jeremy Gillon', 'Garrison Shaker');

UPDATE profiles SET sales_role = 'setter'
 WHERE sales_role IS NULL AND name IN (
  'Adrian Bobbit', 'Bryan Burgos', 'Ethan Whitmore', 'Joseph Burgos', 'Scott Hershman',
  'Stephen Long', 'Brady McKay', 'Charlie Higgins', 'Corbin Davis', 'Zack Fisher',
  'John Kosta', 'Kyltan Hedgcock', 'Ricky Ortiz', 'Tyler Maynard', 'Windsor Muhonen');

-- PostgREST caches the schema; without this the site reports the column as unknown.
NOTIFY pgrst, 'reload schema';
