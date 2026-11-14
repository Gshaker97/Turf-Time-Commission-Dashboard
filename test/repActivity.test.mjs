import { repActivity, rateOrNull } from '../src/utils/repActivity.js'

let pass = 0, fail = 0
const eq = (what, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++; else { fail++; console.log(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}
const ok = (what, c) => { if (c) pass++; else { fail++; console.log(`FAIL ${what}`) } }

const U = [
  { id: 'bryan',  name: 'Bryan Burgos' },
  { id: 'ricky',  name: 'Ricky Marrugo' },
  { id: 'caleb',  name: 'Caleb Sartin' },
  { id: 'jared',  name: 'Jared Aguilar' },   // another team
]
const R = (rows) => Object.fromEntries(rows.map(r => [r.id, r]))

// appointment helper. set_at defaults to the appointment day (pre-051 rows).
const L = (o) => ({ id: o.id, status: o.status ?? 'completed',
  appointment_at: o.at, set_at: o.setAt ?? null,
  setter_id: o.setter ?? null, closer_id: o.closer ?? null,
  customer_name: o.cust ?? 'Cust', ignored: o.ignored ?? false })
const D = (o) => ({ id: o.id, sale_date: o.on, status: o.status ?? 'Paid',
  setter_id: o.setter ?? null, closer_id: o.closer ?? null })

const RANGE = { users: U, from: '2026-10-01', to: '2026-10-31' }

// ── the two groups never overlap ───────────────────────────────────────────
{
  const leads = [
    L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan' }),            // self-gen
    L({ id: 'a2', at: '2026-10-06T17:00:00Z', setter: 'bryan', closer: 'ricky' }),            // bryan set, ricky sat
    L({ id: 'a3', at: '2026-10-07T17:00:00Z', setter: 'caleb', closer: 'bryan' }),            // bryan sat caleb's
  ]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('self-gen counts as SET only',        [r.bryan.set, r.bryan.leadsRan], [2, 1])
  eq('bryan ran 2 of the 2 he set',        r.bryan.ran, 2)
  eq('ricky: sat someone else\'s only',    [r.ricky.set, r.ricky.leadsRan], [0, 1])
  eq('caleb: set one, sat none',           [r.caleb.set, r.caleb.leadsRan, r.caleb.ran], [1, 0, 1])
  // a1 is bryan's self-gen: it must NOT also count as a lead he ran
  ok('a self-gen is never also a lead ran', r.bryan.leadsRan === 1)
}

// ── Ran is "of those they SET", counted whenever it ran ───────────────────
{
  const leads = [
    // booked in range, runs AFTER the range — still counts as ran for the cohort
    L({ id: 'b1', at: '2026-11-20T17:00:00Z', setAt: '2026-10-28T17:00:00Z', setter: 'bryan', closer: 'ricky' }),
    // booked in range, not run yet
    L({ id: 'b2', at: '2026-11-21T17:00:00Z', setAt: '2026-10-29T17:00:00Z', setter: 'bryan', status: 'scheduled' }),
  ]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('set counts on the BOOKED day',       r.bryan.set, 2)
  eq('ran counts even when it ran later',  r.bryan.ran, 1)
  eq('ran rate is a cohort rate',          Math.round(r.bryan.ranRate), 50)
  // ricky sat it in NOVEMBER — outside the range, so no leads-ran credit here
  ok('a lead sat outside the range is not counted', !r.ricky)
}

// ── a setter-less appointment is a LEAD ran, never a self-gen ─────────────
{
  const leads = [L({ id: 'c1', at: '2026-10-09T17:00:00Z', setter: null, closer: 'bryan' })]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('no setter → leads ran', [r.bryan.set, r.bryan.leadsRan], [0, 1])
  eq('and the source reads as nobody', r.bryan.leadFrom[0].name, 'No one recorded')
}

// ── closes come from DEALS, not the CRM status ────────────────────────────
{
  const leads = [
    // RepCard says only "Held", and the site has a signed deal
    L({ id: 'd1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan', status: 'completed' }),
  ]
  const deals = [D({ id: 'x1', on: '2026-10-05', setter: 'bryan', closer: 'bryan' })]
  const r = R(repActivity(leads, deals, RANGE).rows)
  eq('closed comes from the deal, not the disposition', r.bryan.closed, 1)
}

// ── canceled / hidden deals never count ───────────────────────────────────
{
  const deals = [
    D({ id: 'x1', on: '2026-10-05', setter: 'bryan' }),
    D({ id: 'x2', on: '2026-10-06', setter: 'bryan', status: 'Canceled' }),
    { ...D({ id: 'x3', on: '2026-10-07', setter: 'bryan' }), hidden: true },
  ]
  const r = R(repActivity([], deals, RANGE).rows)
  eq('canceled and hidden drop out', r.bryan.closed, 1)
}

// ── a lead close lands on the CLOSER's right-hand group ───────────────────
{
  const deals = [D({ id: 'x1', on: '2026-10-05', setter: 'bryan', closer: 'ricky' })]
  const r = R(repActivity([], deals, RANGE).rows)
  eq('setter gets Closed',       [r.bryan.closed, r.bryan.leadsClosed], [1, 0])
  eq('closer gets Leads Closed', [r.ricky.closed, r.ricky.leadsClosed], [0, 1])
  eq('and it names who',         r.ricky.leadFrom[0].name, 'Bryan Burgos')
}

// ── DISTINCT totals: one appointment, one deal, however many rows ─────────
{
  const leads = [L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'ricky' })]
  const deals = [D({ id: 'x1', on: '2026-10-05', setter: 'bryan', closer: 'ricky' })]
  const out = repActivity(leads, deals, RANGE)
  eq('column totals double-count by design',
     [out.totals.set, out.totals.leadsRan, out.totals.closed, out.totals.leadsClosed], [1, 1, 1, 1])
  eq('distinct counts it ONCE', [out.distinct.appointments, out.distinct.deals], [1, 1])
  eq('overall close rate uses the distinct pair', out.distinct.closeRate, 100)
}

// ── the team filter picks the ROSTER, not the appointments ────────────────
{
  const leads = [
    L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'jared', closer: 'bryan' }), // other team's lead
    L({ id: 'a2', at: '2026-10-06T17:00:00Z', setter: 'bryan', closer: 'bryan' }),
  ]
  const r = R(repActivity(leads, [], { ...RANGE, onlyIds: ['bryan', 'ricky', 'caleb'] }).rows)
  eq('bryan keeps the cross-team lead on HIS team', r.bryan.leadsRan, 1)
  eq('and it names the other rep',                  r.bryan.leadFrom[0].name, 'Jared Aguilar')
  ok('jared gets no row under this team',           !r.jared)
}

// ── ignored (duplicate) appointments are skipped ──────────────────────────
{
  const leads = [
    L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan' }),
    L({ id: 'a2', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan', ignored: true }),
  ]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('an ignored row counts nowhere', r.bryan.set, 1)
}

// ── a rate over 100% blanks rather than capping ───────────────────────────
{
  // 1 appointment logged, 3 signed deals — the logging gap, not performance
  const leads = [L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan' })]
  const deals = [1, 2, 3].map(n => D({ id: 'x' + n, on: '2026-10-0' + n, setter: 'bryan' }))
  const r = R(repActivity(leads, deals, RANGE).rows)
  eq('closed is honest',            r.bryan.closed, 3)
  eq('but the rate blanks',         r.bryan.closeRate, null)
  eq('never capped at 100',         rateOrNull(3, 1), null)
  eq('a real rate still computes',  Math.round(rateOrNull(1, 4)), 25)
  eq('zero denominator blanks',     rateOrNull(0, 0), null)
  eq('exactly 100 is kept',         rateOrNull(2, 2), 100)
}

// ── timestamps: a 6pm Arizona appointment is not tomorrow ─────────────────
{
  process.env.TZ = 'America/Phoenix'
  // 2026-10-31 18:00 Phoenix = 2026-11-01T01:00Z. A UTC slice would push it
  // out of an October range; apptDay must keep it on the 31st.
  const leads = [L({ id: 'a1', at: '2026-11-01T01:00:00Z', setter: 'bryan', closer: 'bryan' })]
  const r = R(repActivity(leads, [], RANGE).rows)
  ok('an evening appointment stays in its own month', !!r.bryan && r.bryan.set === 1)
}

// ── the appointment list carries the role and both people ─────────────────
{
  const leads = [
    L({ id: 'a1', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: 'bryan', cust: 'Jensen' }),
    L({ id: 'a2', at: '2026-10-06T17:00:00Z', setter: 'bryan', closer: 'ricky', cust: 'Whitaker' }),
    L({ id: 'a3', at: '2026-10-07T17:00:00Z', setter: 'caleb', closer: 'bryan', cust: 'Reyes' }),
  ]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('three appointments on his card', r.bryan.appts.length, 3)
  eq('roles', r.bryan.appts.map(a => a.role), ['self', 'set', 'closer'])
  eq('sorted by appointment time', r.bryan.appts.map(a => a.customer), ['Jensen', 'Whitaker', 'Reyes'])
  eq('both people ride along', [r.bryan.appts[1].setterId, r.bryan.appts[1].closerId], ['bryan', 'ricky'])
}

// ── a scheduled appointment with no closer is SET, not self-gen ──────────
{
  // `ranBy` falls back to the setter when no closer is recorded, which made an
  // unrun appointment read as self-generated. Caught in the browser, not here.
  const leads = [
    L({ id: 'z1', at: '2026-10-28T16:00:00Z', setter: 'bryan', closer: null, status: 'scheduled' }),
    L({ id: 'z2', at: '2026-10-05T17:00:00Z', setter: 'bryan', closer: null, status: 'completed' }),
  ]
  const r = R(repActivity(leads, [], RANGE).rows)
  eq('not yet run reads as Set', r.bryan.appts.find(a => a.id === 'z1').role, 'set')
  eq('ran with no closer IS self-gen', r.bryan.appts.find(a => a.id === 'z2').role, 'self')
  eq('counts are unaffected', [r.bryan.set, r.bryan.ran, r.bryan.leadsRan], [2, 1, 0])
}

// ── revenue: owner-credited vs lead, never summed ────────────────────────
{
  const deals = [
    { ...D({ id: 'r1', on: '2026-10-05', setter: 'bryan', closer: 'ricky' }), baseline_revenue: 12000 },
    { ...D({ id: 'r2', on: '2026-10-06', setter: 'bryan', closer: 'bryan' }), baseline_revenue: 8000 },
    { ...D({ id: 'r3', on: '2026-10-07', setter: 'caleb', closer: 'ricky' }), baseline_revenue: 5000 },
  ]
  const out = repActivity([], deals, RANGE)
  const r = R(out.rows)
  eq('owner gets revenue',        [r.bryan.revenue, r.bryan.leadRevenue], [20000, 0])
  eq('closer gets lead revenue',  [r.ricky.revenue, r.ricky.leadRevenue], [0, 17000])
  eq('a self-gen counts once',    r.bryan.closed, 2)
  eq('totals carry both',         [out.totals.revenue, out.totals.leadRevenue], [25000, 17000])
  // The two columns deliberately overlap: r1 is $12k of Bryan's revenue AND
  // $12k of Ricky's lead revenue. Summing them double-counts that sale.
  ok('the two columns overlap on purpose',
     out.totals.revenue + out.totals.leadRevenue > 25000)
  eq('revenue is BASELINE, never job price', r.caleb.revenue, 5000)
}

// ── canceled / hidden carry no revenue either ────────────────────────────
{
  const deals = [
    { ...D({ id: 'r1', on: '2026-10-05', setter: 'bryan' }), baseline_revenue: 9000 },
    { ...D({ id: 'r2', on: '2026-10-06', setter: 'bryan', status: 'Canceled' }), baseline_revenue: 9000 },
    { ...D({ id: 'r3', on: '2026-10-07', setter: 'bryan' }), baseline_revenue: 9000, hidden: true },
  ]
  eq('only the live deal pays', R(repActivity([], deals, RANGE).rows).bryan.revenue, 9000)
}

// ── a missing baseline is 0, not NaN ─────────────────────────────────────
{
  const deals = [D({ id: 'r1', on: '2026-10-05', setter: 'bryan' })]   // no baseline_revenue
  eq('null baseline reads 0', R(repActivity([], deals, RANGE).rows).bryan.revenue, 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
