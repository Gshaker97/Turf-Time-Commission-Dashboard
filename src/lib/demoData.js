// Demo data — mirrors the Turf Time roster in supabase/migrations/003_seed.sql.
// Used only when no Supabase env vars are set (local/offline preview).
import { startOfWeek, subWeeks, format } from 'date-fns'

const CO = 'Turf Time'

export const DEMO_USERS = [
  // Leadership
  { id: 'u-keaton',   name: 'Keaton Shaker',   email: 'keaton@turftime.com',   role: 'vp',       company_name: CO, manager_id: null,        director_id: null,         vp_id: null,       active: true },
  { id: 'u-garrison', name: 'Garrison Shaker', email: 'garrison@turftime.com', role: 'director', company_name: CO, manager_id: null,        director_id: null,         vp_id: 'u-keaton', active: true },

  // Managers
  { id: 'u-jared',  name: 'Jared Aguilar', email: 'jared@turftime.com',  role: 'manager', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-danny',  name: 'Danny Jones',   email: 'danny@turftime.com',  role: 'manager', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-colt',   name: 'Colt Niznik',   email: 'colt@turftime.com',   role: 'manager', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-jordan', name: 'Jordan Bagwell',email: 'jordan@turftime.com', role: 'manager', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-conner', name: 'Conner Ipsen',  email: 'conner@turftime.com', role: 'manager', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },

  // Jared's team
  { id: 'u-stephen',  name: 'Stephen Long',    email: 'stephen@turftime.com',  role: 'rep', company_name: CO, manager_id: 'u-jared',  director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-charlieh', name: 'Charlie Higgins', email: 'charlieh@turftime.com', role: 'rep', company_name: CO, manager_id: 'u-jared',  director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  // Danny's team
  { id: 'u-marc',     name: 'Marc Dunham',     email: 'marc@turftime.com',     role: 'rep', company_name: CO, manager_id: 'u-danny',  director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  // Colt's team
  { id: 'u-tylerm',   name: 'Tyler Maynard',   email: 'tylerm@turftime.com',   role: 'rep', company_name: CO, manager_id: 'u-colt',   director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  // Jordan's team
  { id: 'u-jeremy',   name: 'Jeremy Gillon',   email: 'jeremy@turftime.com',   role: 'rep', company_name: CO, manager_id: 'u-jordan', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-mattj',    name: 'Matt Jameson',    email: 'mattj@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-jordan', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-codym',    name: 'Cody Mack',       email: 'codym@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-jordan', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-johnk',    name: 'John Kosta',      email: 'johnk@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-jordan', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-dayton',   name: 'Dayton Jones',    email: 'dayton@turftime.com',   role: 'rep', company_name: CO, manager_id: 'u-jordan', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  // Conner's team
  { id: 'u-caleb',    name: 'Caleb Sartin',    email: 'caleb@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-conner', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-jc',       name: 'JC Correa',       email: 'jc@turftime.com',       role: 'rep', company_name: CO, manager_id: 'u-conner', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-ricky',    name: 'Ricky Marrugo',   email: 'ricky@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-conner', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-bryan',    name: 'Bryan Burgos',    email: 'bryan@turftime.com',    role: 'rep', company_name: CO, manager_id: 'u-conner', director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  // Unmanaged reps
  { id: 'u-casey',    name: 'Casey Lederman',  email: 'casey@turftime.com',    role: 'rep', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },
  { id: 'u-seth',     name: 'Seth Doser',      email: 'seth@turftime.com',     role: 'rep', company_name: CO, manager_id: null, director_id: 'u-garrison', vp_id: 'u-keaton', active: true },

  // Admin
  { id: 'u-admin',    name: 'Turf Time Admin', email: 'admin@turftime.com',    role: 'admin', company_name: CO, manager_id: null, director_id: null, vp_id: null, active: true },
]

// Demo passwords (offline preview only — live mode uses Supabase Auth)
const PW = 'TurfTime2026!'
export const DEMO_CREDENTIALS = DEMO_USERS.reduce((acc, u) => {
  acc[u.email.toLowerCase()] = { password: PW, userId: u.id }
  return acc
}, {})

// ── Helpers ───────────────────────────────────────────────────
const byId = Object.fromEntries(DEMO_USERS.map(u => [u.id, u]))
const slim = (id) => (id && byId[id] ? { id, name: byId[id].name } : null)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// Raw deal → joined deal (embeds {id,name} objects like the live DEAL_SELECT)
function makeDeal(o) {
  const managerId = o.manager_id ?? (byId[o.setter_id]?.manager_id ?? null)
  const d = {
    id: 'deal-' + Math.random().toString(36).slice(2, 9),
    office: o.office ?? 'Phoenix',
    project_id: o.project_id ?? null,
    install_date: o.install_date ?? null,
    pay_date: o.pay_date ?? null,
    status: o.status ?? 'Deal Review',
    setter_split_pct: o.setter_id === o.closer_id ? 1 : (o.setter_split_pct ?? 0.5),
    manager_id: managerId,
    director_id: 'u-garrison',
    vp_id: 'u-keaton',
    manager_override_pct: 0.03,
    director_override_pct: 0.05,
    vp_override_pct: 0.05,
    manager_to_rep_pct: 0, director_to_rep_pct: 0, vp_to_rep_pct: 0,
    setter_amount: null, closer_amount: null,
    manager_amount: null, director_amount: null, vp_amount: null,
    deduction_amount: null, deduction_note: null,
    payment_method: o.payment_method ?? null,
    created_by: 'u-admin',
    created_at: new Date().toISOString(),
    ...o,
  }
  d.manager_id = managerId
  return {
    ...d,
    setter:   slim(d.setter_id),
    closer:   slim(d.closer_id),
    manager:  slim(d.manager_id),
    director: slim(d.director_id),
    vp:       slim(d.vp_id),
  }
}

// A spread of deals across recent months so every page has something to show.
export const DEMO_DEALS_JOINED = [
  // Current-week deals so MTD / This Week landing views aren't empty.
  makeDeal({ deal_name: 'Whitaker — 9 Birchwood Ct',  project_id: 'TT-1023', sale_date: daysAgo(0),   setter_id: 'u-stephen',  closer_id: 'u-stephen',  baseline_revenue: 5400, job_price: 10200, status: 'Deal Review',     payment_method: 'Goodleap' }),
  makeDeal({ deal_name: 'Yamamoto — 71 Clover Way',   project_id: 'TT-1024', sale_date: daysAgo(1),   setter_id: 'u-charlieh', closer_id: 'u-stephen',  baseline_revenue: 5000, job_price: 9400,  status: 'Deal Review',     payment_method: 'Self-Pay + Sunlight', deduction_amount: 250, deduction_note: 'Materials reorder — wrong turf color on first drop.' }),
  makeDeal({ deal_name: 'Anderson — 142 Oak St',     project_id: 'TT-1001', sale_date: daysAgo(2),   setter_id: 'u-stephen',  closer_id: 'u-stephen',  baseline_revenue: 5200, job_price: 9800,  status: 'Deal Review',     payment_method: 'Sunlight' }),
  makeDeal({ deal_name: 'Bradley — 88 Pine Ave',     project_id: 'TT-1002', sale_date: daysAgo(4),   setter_id: 'u-charlieh', closer_id: 'u-stephen',  baseline_revenue: 4800, job_price: 8500,  status: 'Deal Review' }),
  makeDeal({ deal_name: 'Carter — 210 Elm Dr',       project_id: 'TT-1003', sale_date: daysAgo(6),   setter_id: 'u-marc',     closer_id: 'u-marc',     baseline_revenue: 6100, job_price: 11200, status: 'Pending Install', install_date: daysAgo(1) }),
  makeDeal({ deal_name: 'Davis — 55 Cedar Ln',       project_id: 'TT-1004', sale_date: daysAgo(8),   setter_id: 'u-tylerm',   closer_id: 'u-tylerm',   baseline_revenue: 3800, job_price: 7400,  status: 'Pending Install' }),
  makeDeal({ deal_name: 'Evans — 790 Maple Rd',      project_id: 'TT-1005', sale_date: daysAgo(10),  setter_id: 'u-jeremy',   closer_id: 'u-mattj',    baseline_revenue: 5500, job_price: 10100, status: 'Deal Review' }),
  makeDeal({ deal_name: 'Foster — 33 Birch Ct',      project_id: 'TT-1006', sale_date: daysAgo(13),  setter_id: 'u-codym',    closer_id: 'u-codym',    baseline_revenue: 4200, job_price: 8100,  status: 'Pending Install', install_date: daysAgo(3) }),
  makeDeal({ deal_name: 'Garcia — 415 Spruce Way',   project_id: 'TT-1007', sale_date: daysAgo(15),  setter_id: 'u-johnk',    closer_id: 'u-dayton',   baseline_revenue: 5800, job_price: 12000, status: 'Pay Finalized', install_date: daysAgo(6) }),
  makeDeal({ deal_name: 'Hernandez — 22 Walnut Blvd',project_id: 'TT-1008', sale_date: daysAgo(18),  setter_id: 'u-caleb',    closer_id: 'u-caleb',    baseline_revenue: 6800, job_price: 14500, status: 'Pay Finalized', install_date: daysAgo(8) }),
  makeDeal({ deal_name: 'Ingram — 701 Aspen St',     project_id: 'TT-1009', sale_date: daysAgo(22),  setter_id: 'u-jc',       closer_id: 'u-ricky',    baseline_revenue: 4600, job_price: 9200,  status: 'Pending Install' }),
  makeDeal({ deal_name: 'Jensen — 58 Poplar Ave',    project_id: 'TT-1010', sale_date: daysAgo(25),  setter_id: 'u-bryan',    closer_id: 'u-bryan',    baseline_revenue: 3500, job_price: 6800,  status: 'Paid', install_date: daysAgo(15), pay_date: daysAgo(8) }),
  makeDeal({ deal_name: 'Kim — 320 Willow Dr',       project_id: 'TT-1011', sale_date: daysAgo(28),  setter_id: 'u-casey',    closer_id: 'u-seth',     baseline_revenue: 5100, job_price: 9600,  status: 'Paid', install_date: daysAgo(18), pay_date: daysAgo(10), manager_id: null }),
  makeDeal({ deal_name: 'Lopez — 14 Magnolia Ln',    project_id: 'TT-1012', sale_date: daysAgo(33),  setter_id: 'u-stephen',  closer_id: 'u-charlieh', baseline_revenue: 7200, job_price: 13800, status: 'Paid', install_date: daysAgo(22), pay_date: daysAgo(12) }),
  makeDeal({ deal_name: 'Morris — 89 Cypress Ct',    project_id: 'TT-1013', sale_date: daysAgo(38),  setter_id: 'u-marc',     closer_id: 'u-marc',     baseline_revenue: 4000, job_price: 7600,  status: 'Sales Issue' }),
  makeDeal({ deal_name: 'Nelson — 256 Redwood Rd',   project_id: 'TT-1014', sale_date: daysAgo(42),  setter_id: 'u-tylerm',   closer_id: 'u-tylerm',   baseline_revenue: 5600, job_price: 10400, status: 'Paid', install_date: daysAgo(30), pay_date: daysAgo(20) }),
  makeDeal({ deal_name: 'Ortega — 103 Sycamore Way', project_id: 'TT-1015', sale_date: daysAgo(46),  setter_id: 'u-jeremy',   closer_id: 'u-johnk',    baseline_revenue: 6400, job_price: 12800, status: 'Paid', install_date: daysAgo(33), pay_date: daysAgo(22) }),
  makeDeal({ deal_name: 'Park — 77 Juniper St',      project_id: 'TT-1016', sale_date: daysAgo(52),  setter_id: 'u-codym',    closer_id: 'u-codym',    baseline_revenue: 4900, job_price: 9100,  status: 'Paid', install_date: daysAgo(40), pay_date: daysAgo(28) }),
  makeDeal({ deal_name: 'Quinn — 445 Rosewood Ave',  project_id: 'TT-1017', sale_date: daysAgo(58),  setter_id: 'u-caleb',    closer_id: 'u-jc',       baseline_revenue: 5300, job_price: 10200, status: 'Paid', install_date: daysAgo(45), pay_date: daysAgo(33) }),
  makeDeal({ deal_name: 'Ramirez — 19 Ironwood Dr',  project_id: 'TT-1018', sale_date: daysAgo(64),  setter_id: 'u-ricky',    closer_id: 'u-bryan',    baseline_revenue: 6700, job_price: 13500, status: 'Paid', install_date: daysAgo(50), pay_date: daysAgo(38) }),
  makeDeal({ deal_name: 'Sanders — 612 Palm Ct',     project_id: 'TT-1019', sale_date: daysAgo(70),  setter_id: 'u-dayton',   closer_id: 'u-dayton',   baseline_revenue: 4400, job_price: 8300,  status: 'Paid', install_date: daysAgo(58), pay_date: daysAgo(45) }),
  makeDeal({ deal_name: 'Torres — 5 Acacia Ln',      project_id: 'TT-1020', sale_date: daysAgo(78),  setter_id: 'u-mattj',    closer_id: 'u-jeremy',   baseline_revenue: 5900, job_price: 11400, status: 'Paid', install_date: daysAgo(64), pay_date: daysAgo(52) }),
  makeDeal({ deal_name: 'Underwood — 88 Sage Dr',    project_id: 'TT-1021', sale_date: daysAgo(86),  setter_id: 'u-stephen',  closer_id: 'u-stephen',  baseline_revenue: 5000, job_price: 9400,  status: 'Paid', install_date: daysAgo(72), pay_date: daysAgo(60) }),
  makeDeal({ deal_name: 'Vance — 240 Olive St',      project_id: 'TT-1022', sale_date: daysAgo(95),  setter_id: 'u-marc',     closer_id: 'u-marc',     baseline_revenue: 6200, job_price: 11900, status: 'Paid', install_date: daysAgo(80), pay_date: daysAgo(68) }),
]

// A few payment records (against Paid deals) so the Commissions/Admin pages have data.
const paidDeals = DEMO_DEALS_JOINED.filter(d => d.status === 'Paid')
export const DEMO_PAYMENTS = paidDeals.slice(0, 8).map((d, i) => ({
  id: 'pay-' + Math.random().toString(36).slice(2, 9),
  deal_id: d.id,
  user_id: d.setter_id,
  amount: Math.round(((d.job_price - d.baseline_revenue) * (d.closer_id === d.setter_id ? 1 : 0.5)) * 100) / 100,
  pay_date: d.pay_date,
  notes: i % 3 === 0 ? 'Direct deposit' : null,
  created_by: 'u-admin',
  deal: { deal_name: d.deal_name },
  user: { name: byId[d.setter_id]?.name ?? '—' },
}))

// Monthly goals keyed "YYYY-M" (baseline target). Mirrors 003_seed.sql.
export const DEMO_GOALS = (() => {
  const g = {}
  for (let m = 1; m <= 12; m++) g[`2026-${m}`] = 600000
  return g
})()

// Admin-editable site settings (mirrors app_settings seed in 006_settings.sql).
export const DEMO_SETTINGS = {
  deal_statuses: [
    { label: 'Deal Review',     color: '#94a3b8' },
    { label: 'Pending Install', color: '#2dd4bf' },
    { label: 'Pay Finalized',   color: '#22d3ee' },
    { label: 'Paid',            color: '#4ade80' },
    { label: 'Sales Issue',     color: '#f87171' },
  ],
  payment_methods: ['Self-Pay', 'Goodleap', 'Sunlight', 'Self-Pay + Sunlight', 'Self-Pay + Goodleap'],
  offices: ['Phoenix', 'Tucson'],
}

// Weekly estimate counts per rep, for the Weekly Stats tracker. Closed deals
// are derived from DEMO_DEALS_JOINED, so we only seed the manually-entered
// estimate counts here, for the current week + the last few weeks.
export const DEMO_WEEKLY_STATS = (() => {
  // Same week-start logic as the Weekly Stats component (Monday, local time)
  // so seeded estimates line up with the derived weekly buckets.
  const monday = (weeksAgo) =>
    format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const repIds = DEMO_USERS.filter(u => u.role === 'rep').map(u => u.id)
  // Kept small so close rates (closed ÷ estimates) read realistically against
  // the sparse demo deal set.
  const baseByRep = [4, 4, 5, 3, 5, 4, 4, 3, 4, 3, 3, 4, 3, 3, 3]
  const rows = []
  repIds.forEach((id, idx) => {
    const base = baseByRep[idx % baseByRep.length]
    for (let w = 0; w <= 3; w++) {
      rows.push({ rep_id: id, week_start: monday(w), estimates: Math.max(2, base - w) })
    }
  })
  return rows
})()
