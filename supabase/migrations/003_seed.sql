-- ============================================================
-- 003_seed.sql — Turf Time roster + initial goals
-- After running: create matching auth.users in Studio (Step 4).
-- ============================================================

DO $$
DECLARE
  -- Leadership
  id_keaton    UUID := gen_random_uuid();
  id_garrison  UUID := gen_random_uuid();

  -- Managers
  id_jared     UUID := gen_random_uuid();
  id_danny     UUID := gen_random_uuid();
  id_colt      UUID := gen_random_uuid();
  id_jordan    UUID := gen_random_uuid();
  id_conner    UUID := gen_random_uuid();

  -- Reps under Jared
  id_stephen   UUID := gen_random_uuid();
  id_charlieh  UUID := gen_random_uuid();

  -- Reps under Danny
  id_marc      UUID := gen_random_uuid();

  -- Reps under Colt
  id_tylerm    UUID := gen_random_uuid();

  -- Reps under Jordan
  id_jeremy    UUID := gen_random_uuid();
  id_mattj     UUID := gen_random_uuid();
  id_codym     UUID := gen_random_uuid();
  id_johnk     UUID := gen_random_uuid();
  id_dayton    UUID := gen_random_uuid();

  -- Reps under Conner
  id_caleb     UUID := gen_random_uuid();
  id_jc        UUID := gen_random_uuid();
  id_ricky     UUID := gen_random_uuid();
  id_bryan     UUID := gen_random_uuid();

  -- Unmanaged reps
  id_casey     UUID := gen_random_uuid();
  id_seth      UUID := gen_random_uuid();

  -- Admin
  id_admin     UUID := gen_random_uuid();
BEGIN

INSERT INTO profiles (id, name, email, role, manager_id, director_id, vp_id, company_name, active) VALUES
  -- Leadership
  (id_keaton,   'Keaton Shaker',   'keaton@turftime.com',   'vp',       NULL,        NULL,        NULL,      'Turf Time', TRUE),
  (id_garrison, 'Garrison Shaker', 'garrison@turftime.com', 'director', NULL,        NULL,        id_keaton, 'Turf Time', TRUE),

  -- Managers — manager_id = themselves not allowed; they report up to Garrison (director) / Keaton (vp)
  (id_jared,    'Jared Aguilar',   'jared@turftime.com',    'manager',  NULL,        id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_danny,    'Danny Jones',     'danny@turftime.com',    'manager',  NULL,        id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_colt,     'Colt Niznik',     'colt@turftime.com',     'manager',  NULL,        id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_jordan,   'Jordan Bagwell',  'jordan@turftime.com',   'manager',  NULL,        id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_conner,   'Conner Ipsen',    'conner@turftime.com',   'manager',  NULL,        id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Jared's team
  (id_stephen,  'Stephen Long',    'stephen@turftime.com',  'rep', id_jared,  id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_charlieh, 'Charlie Higgins', 'charlieh@turftime.com', 'rep', id_jared,  id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Danny's team
  (id_marc,     'Marc Dunham',     'marc@turftime.com',     'rep', id_danny,  id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Colt's team
  (id_tylerm,   'Tyler Maynard',   'tylerm@turftime.com',   'rep', id_colt,   id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Jordan's team
  (id_jeremy,   'Jeremy Gillon',   'jeremy@turftime.com',   'rep', id_jordan, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_mattj,    'Matt Jameson',    'mattj@turftime.com',    'rep', id_jordan, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_codym,    'Cody Mack',       'codym@turftime.com',    'rep', id_jordan, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_johnk,    'John Kosta',      'johnk@turftime.com',    'rep', id_jordan, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_dayton,   'Dayton Jones',    'dayton@turftime.com',   'rep', id_jordan, id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Conner's team
  (id_caleb,    'Caleb Sartin',    'caleb@turftime.com',    'rep', id_conner, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_jc,       'JC Correa',       'jc@turftime.com',       'rep', id_conner, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_ricky,    'Ricky Marrugo',   'ricky@turftime.com',    'rep', id_conner, id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_bryan,    'Bryan Burgos',    'bryan@turftime.com',    'rep', id_conner, id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Unmanaged reps (manager-tier override goes to Garrison directly)
  (id_casey,    'Casey Lederman',  'casey@turftime.com',    'rep', NULL,      id_garrison, id_keaton, 'Turf Time', TRUE),
  (id_seth,     'Seth Doser',      'seth@turftime.com',     'rep', NULL,      id_garrison, id_keaton, 'Turf Time', TRUE),

  -- Admin (rename or attach to Keaton's auth_id later if you prefer)
  (id_admin,    'Turf Time Admin', 'admin@turftime.com',    'admin', NULL,    NULL,        NULL,      'Turf Time', TRUE);

-- Initial monthly goals (the dashboard uses these)
INSERT INTO monthly_goals (year, month, baseline_target) VALUES
  (2026, 1,  600000),
  (2026, 2,  600000),
  (2026, 3,  600000),
  (2026, 4,  600000),
  (2026, 5,  600000),
  (2026, 6,  600000),
  (2026, 7,  600000),
  (2026, 8,  600000),
  (2026, 9,  600000),
  (2026, 10, 600000),
  (2026, 11, 600000),
  (2026, 12, 600000)
ON CONFLICT (year, month) DO NOTHING;

END $$;
