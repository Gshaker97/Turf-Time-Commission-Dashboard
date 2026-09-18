import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronDown, Upload, SlidersHorizontal, AlertTriangle, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  fetchDeals, fetchUsers, fetchTeamChanges, fetchLeads, fetchFieldActivity, fetchGoal, upsertFieldActivity,
} from '../lib/db'
import { PRESETS, getPresetRange, getPreviousRange } from '../utils/dateRanges'
import { headIdSet, buildChangesByProfile } from '../utils/team'
import { buildPerformance, repFlags, delta, deltaPts, DEFAULT_FLOORS } from '../utils/perfSummary'
import { fmtClock, fmtHours, csvToFieldActivity } from '../utils/fieldActivity'
import DateRangeFilter from '../components/DateRangeFilter'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { toast } from '../lib/toast'

// ── One page, one truth: org scoreboard → by office → appointments & field →
// one section per team (RepCard field activity | site results). All math in
// utils/perfSummary.js; this file only renders.

const CARD  = { background: '#1e1e1e', border: '1px solid #2a2a2a' }
const CARD2 = { background: '#242424', border: '1px solid #2e2e2e' }
const REPCARD = '#a78bfa'   // field-activity + appointment figures (CRM feed)
const SITE    = '#2dd4bf'   // deals / revenue / commission (this site)
const PREFS_KEY = 'tt_perf2_prefs'
const RANGE_PRESETS = PRESETS.filter(p => p.key !== 'all')   // "All time" has no comparable previous period

const money0 = (v) => (v == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString())
const pct1   = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
const int0   = (v) => (v == null ? '—' : Math.round(v).toLocaleString())
const dec1   = (v) => (v == null ? '—' : (Number.isInteger(v) ? String(v) : v.toFixed(1)))
const fmtDay = (iso) => (iso ? format(new Date(iso + 'T12:00:00'), 'MMM d') : '')
const fmtRangeLabel = (from, to) => (!from && !to ? 'All time' : `${fmtDay(from)} – ${fmtDay(to)}`)

function SourceTag({ kind }) {
  const rc = kind === 'repcard'
  return (
    <span className="inline-block text-[8.5px] font-bold uppercase tracking-[0.08em] px-1.5 py-[1px] rounded-full align-middle"
      style={{ color: rc ? REPCARD : SITE, border: `1px solid ${rc ? REPCARD : SITE}66` }}>
      {rc ? 'RepCard' : 'Site'}
    </span>
  )
}

// ▲ 12.4% / ▼ 0.9 pt — green up, red down (inverse for lower-is-better).
function Delta({ cur, prev, rate = false, inverse = false, prevText }) {
  const d = rate ? deltaPts(cur, prev) : delta(cur, prev)
  if (!d) return prev != null && prevText != null ? <span className="text-white/25 text-[11px]">prev {prevText}</span> : null
  const good = inverse ? d.dir < 0 : d.dir > 0
  const color = d.dir === 0 ? 'text-white/35' : good ? 'text-emerald-400' : 'text-red-400'
  const arrow = d.dir > 0 ? '▲' : d.dir < 0 ? '▼' : '•'
  const txt = rate ? `${Math.abs(d.pts).toFixed(1)} pt` : `${Math.abs(d.pct).toFixed(1)}%`
  return (
    <span className="text-[11px] whitespace-nowrap">
      <span className={`font-semibold ${color}`}>{arrow} {txt}</span>
      {prevText != null && <span className="text-white/25"> · prev {prevText}</span>}
    </span>
  )
}

function Tile({ label, value, sub, source, children, big = true }) {
  return (
    <div className="rounded-xl px-3.5 py-3 min-w-0" style={CARD}>
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30 flex items-center gap-1.5 flex-wrap">
        {label}{source && <SourceTag kind={source} />}
      </p>
      <p className={`${big ? 'text-[22px]' : 'text-[17px]'} font-extrabold text-white mt-1 leading-none tabular-nums`}>{value}</p>
      {(sub || children) && <div className="mt-1.5 flex items-center gap-2 flex-wrap min-h-[14px]">{sub}{children}</div>}
    </div>
  )
}

// ── Admin: red-flag floors ────────────────────────────────────────────────
function FloorsEditor({ floors, onSave, onClose }) {
  const [f, setF] = useState({ ...DEFAULT_FLOORS, ...(floors || {}) })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const Row = ({ k, label, hint }) => (
    <label className="flex items-center justify-between gap-3 text-[12px] text-white/70">
      <span>{label}<span className="block text-[10px] text-white/30">{hint}</span></span>
      <input type="number" min="0" step="0.5" value={f[k]} onChange={e => set(k, e.target.value)}
        className="w-20 px-2 py-1 rounded-lg text-[12px] text-white text-right focus:outline-none" style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
    </label>
  )
  return (
    <div className="rounded-xl p-4 space-y-3 w-full md:w-[360px]" style={CARD2}>
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-white">Red-flag floors</p>
        <button onClick={onClose} className="text-[11px] text-white/40 hover:text-white">Close</button>
      </div>
      <p className="text-[10.5px] text-white/35">A rep's number turns red when it's below the floor for the selected range. Door floors only apply once field activity is coming in.</p>
      <Row k="doors_per_day" label="Doors per knock day" hint="Average doors on days they knocked" />
      <Row k="knock_days"    label="Knock days"          hint="Days with at least one door" />
      <Row k="set"           label="Appointments set"    hint="In the selected range" />
      <Row k="ran"           label="Appointments ran"    hint="In the selected range" />
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.max(0, Number(v) || 0)])))}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-teal text-dark">Save floors</button>
      </div>
    </div>
  )
}

// ── Admin: CSV import of daily field-activity summaries (until the webhook lands)
function ImportActivity({ users, onDone }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const { rows, errors, unmatched } = csvToFieldActivity(text, users)
      if (!rows.length) { toast.error(errors[0] || 'Nothing importable in that file.'); return }
      const res = await upsertFieldActivity(rows)
      if (res?.error) { toast.error('Import failed: ' + (res.error.message || 'unknown error')); return }
      toast.success(`Imported ${rows.length} day row${rows.length === 1 ? '' : 's'}${errors.length ? ` · ${errors.length} skipped` : ''}`)
      if (unmatched?.length) toast.info(`No roster match for: ${unmatched.slice(0, 6).join(', ')}${unmatched.length > 6 ? '…' : ''} — their rows landed by name.`)
      onDone?.()
    } finally { setBusy(false) }
  }
  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      <button onClick={() => ref.current?.click()} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-40"
        style={{ border: '1px solid #333' }} title="Import a RepCard door-knock report (CSV: rep, date, doors, first/last knock, time in field)">
        <Upload size={12} /> {busy ? 'Importing…' : 'Import field CSV'}
      </button>
    </>
  )
}

// ── One team ─────────────────────────────────────────────────────────────
const TH = ({ children, className = '', right = true }) => (
  <th className={`py-1.5 px-2 text-[9.5px] font-bold uppercase tracking-[0.06em] text-white/30 whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
)
const TD = ({ children, flag, strong, className = '' }) => (
  <td className={`py-2 px-2 text-[12px] whitespace-nowrap text-right tabular-nums ${flag ? 'text-red-400 font-bold' : strong ? 'text-white font-semibold' : 'text-white/75'} ${className}`}>{children}</td>
)

function TeamSection({ team, collapsed, onToggle, isAdmin, floors, showCommission }) {
  const t = team.totals, p = team.prev
  const rows = team.rows.filter(r => isAdmin || !r.ghost)
  const hasAct = t.hasActivity
  const cmpText = (v, f) => (p ? f(v) : undefined)
  return (
    <section id={`team-${team.key}`} className="rounded-xl" style={team.unassigned ? { ...CARD, borderStyle: 'dashed', borderColor: 'rgba(251,191,36,0.35)' } : CARD}>
      {/* Header — always visible; click to collapse */}
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <ChevronDown size={14} className={`text-white/30 flex-shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        <span className={`text-[16px] font-extrabold ${team.unassigned ? 'text-amber-300' : 'text-white'}`}>{team.label}</span>
        <span className="text-[11px] text-white/40 truncate">
          {team.unassigned ? 'Owner on no current team'
            : team.historical ? `Former team · led by ${team.head?.name ?? '—'}`
            : <>Led by <span className="text-white/70">{team.head?.name}</span></>}
          {' · '}{team.members} {team.members === 1 ? 'person' : 'people'}
        </span>
        {collapsed && (
          <span className="ml-auto text-[12px] text-white/60 tabular-nums whitespace-nowrap">
            {money0(t.revenue)} · {t.deals} deal{t.deals === 1 ? '' : 's'}{t.markupPct != null ? ` · ${pct1(t.markupPct)} markup` : ''}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3">
          {/* Team tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="rounded-lg px-3 py-2" style={CARD2}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Revenue</p>
              <p className="text-[17px] font-extrabold text-white mt-0.5 tabular-nums">{money0(t.revenue)}</p>
              <Delta cur={t.revenue} prev={p?.revenue} prevText={cmpText(p?.revenue, money0)} />
            </div>
            <div className="rounded-lg px-3 py-2" style={CARD2}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Deals</p>
              <p className="text-[17px] font-extrabold text-white mt-0.5 tabular-nums">{t.deals}</p>
              <Delta cur={t.deals} prev={p?.deals} prevText={cmpText(p?.deals, int0)} />
            </div>
            <div className="rounded-lg px-3 py-2" style={CARD2}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Avg deal size</p>
              <p className="text-[17px] font-extrabold text-white mt-0.5 tabular-nums">{money0(t.avgDeal)}</p>
              <Delta cur={t.avgDeal} prev={p?.avgDeal} prevText={cmpText(p?.avgDeal, money0)} />
            </div>
            <div className="rounded-lg px-3 py-2" style={CARD2}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Avg markup</p>
              <p className="text-[17px] font-extrabold text-white mt-0.5 tabular-nums">{pct1(t.markupPct)}</p>
              <Delta cur={t.markupPct} prev={p?.markupPct} rate prevText={cmpText(p?.markupPct, pct1)} />
            </div>
            <div className="rounded-lg px-3 py-2" style={CARD2}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Active reps</p>
              <p className="text-[17px] font-extrabold text-white mt-0.5 tabular-nums">{team.members}</p>
              <span className="text-[11px] text-white/25">{hasAct ? `${team.knockers} knocked` : `${rows.filter(r => r.deals > 0).length} sold`} this period</span>
            </div>
          </div>

          {/* Rep table */}
          <div className="overflow-x-auto -mx-4 px-4 mt-3">
            <table className="w-full border-collapse min-w-[980px]">
              <thead>
                <tr>
                  <th></th>
                  <th colSpan={9} className="text-left px-2 pt-1 pb-0.5">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.1em]" style={{ color: REPCARD }}>Field activity · RepCard</span>
                  </th>
                  <th colSpan={showCommission ? 4 : 3} className="text-left px-2 pt-1 pb-0.5" style={{ borderLeft: '1px solid #333' }}>
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.1em]" style={{ color: SITE }}>Results · Site</span>
                  </th>
                </tr>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <TH right={false}>Rep</TH>
                  <TH>Doors</TH><TH>Set</TH><TH>Ran</TH><TH>Self-gen / Leads</TH><TH>Doors / day</TH>
                  <TH>First knock</TH><TH>Last knock</TH><TH>Field time</TH><TH>Knock days</TH>
                  <TH className="border-l border-[#333]">Deals</TH><TH>Revenue</TH><TH>Markup</TH>
                  {showCommission && <TH>Commission</TH>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={14} className="py-3 px-2 text-[12px] text-white/30">Nobody on this team in the selected range.</td></tr>
                )}
                {rows.map(r => {
                  const fl = repFlags(r, floors, hasAct)
                  const dash = !hasAct && r.doors === 0
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #262626' }} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-[12.5px] text-white/85 whitespace-nowrap">
                        <span className="font-semibold">{r.name}</span>
                        {r.isHead && <span className="ml-1.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-teal">{r.role}</span>}
                        {r.ghost && isAdmin && <span className="ml-1.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-white/30">ghost</span>}
                        {!r.member && <span className="block text-[9.5px] text-white/30">Moved teams — only this team's work shown</span>}
                        {!r.active && <span className="block text-[9.5px] text-white/30">Deactivated</span>}
                      </td>
                      <TD flag={fl.doors}>{dash ? '—' : int0(r.doors)}</TD>
                      <TD flag={fl.set}>{r.set}</TD>
                      <TD flag={fl.ran}>{r.ran}</TD>
                      <TD>{r.sgRan} / {r.leadRan}</TD>
                      <TD flag={fl.doorsPerDay}>{dash ? '—' : dec1(r.doorsPerDay)}</TD>
                      <TD>{dash ? '—' : fmtClock(r.firstKnock)}</TD>
                      <TD>{dash ? '—' : fmtClock(r.lastKnock)}</TD>
                      <TD flag={fl.fieldMinutes}>{dash ? '—' : fmtHours(r.fieldMinutes)}</TD>
                      <TD flag={fl.knockDays}>{dash ? '—' : r.knockDays}</TD>
                      <TD strong className="border-l border-[#333]">{r.deals}</TD>
                      <TD strong>{money0(r.revenue)}</TD>
                      <TD>{pct1(r.markupPct)}</TD>
                      {showCommission && <TD strong>{money0(r.commission)}</TD>}
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '1px solid #333' }}>
                    <td className="py-2 px-2 text-[9.5px] font-bold uppercase tracking-[0.1em] text-white/40">Team</td>
                    <TD strong>{hasAct ? int0(t.doors) : '—'}</TD>
                    <TD strong>{t.set}</TD>
                    <TD strong>{t.ran}</TD>
                    <TD strong>{t.sgRan} / {t.leadRan}</TD>
                    <TD strong>{hasAct ? dec1(t.doorsPerDay) : '—'}</TD>
                    <TD></TD><TD></TD>
                    <TD strong>{hasAct ? fmtHours(t.fieldMinutes) : '—'}</TD>
                    <TD strong>{hasAct ? t.knockDays : '—'}</TD>
                    <TD strong className="border-l border-[#333]">{t.deals}</TD>
                    <TD strong>{money0(t.revenue)}</TD>
                    <TD strong>{pct1(t.markupPct)}</TD>
                    {showCommission && <TD strong>{money0(t.commission)}</TD>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function Performance() {
  const { profile, isAdmin } = useAuth()
  const { perfFloors, save } = useSettings()

  const [deals, setDeals] = useState([])
  const [users, setUsers] = useState([])
  const [teamChanges, setTeamChanges] = useState([])
  const [leads, setLeads] = useState([])
  const [activity, setActivity] = useState([])
  const [goal, setGoal] = useState(null)
  const [loading, setLoading] = useState(true)

  const [prefs, setPrefs] = useState(() => {
    try { return { compare: true, collapsed: [], ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } }
    catch { return { compare: true, collapsed: [] } }
  })
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ } }, [prefs])
  const [range, setRange] = useState(() => ({ ...getPresetRange('mtd'), preset: 'mtd' }))
  const [showFloors, setShowFloors] = useState(false)

  const loadData = () => Promise.all([fetchDeals(), fetchUsers(), fetchTeamChanges(), fetchLeads(), fetchFieldActivity()])
    .then(([d, u, tc, l, fa]) => {
      setDeals(d.data ?? []); setUsers(u.data ?? []); setTeamChanges(tc.data ?? [])
      setLeads(l.data ?? []); setActivity(fa.data ?? [])
    })
  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)

  // Company monthly goal — only meaningful when the range sits inside one month.
  const goalMonth = useMemo(() => {
    if (!range.from || !range.to || range.from.slice(0, 7) !== range.to.slice(0, 7)) return null
    return { year: Number(range.to.slice(0, 4)), month: Number(range.to.slice(5, 7)) }
  }, [range.from, range.to])
  useEffect(() => {
    if (!goalMonth) { setGoal(null); return }
    let alive = true
    fetchGoal(goalMonth.year, goalMonth.month).then(({ data }) => { if (alive) setGoal(data != null ? Number(data) : null) })
    return () => { alive = false }
  }, [goalMonth?.year, goalMonth?.month])

  const teamCtx = useMemo(() => ({
    usersById: Object.fromEntries(users.map(u => [u.id, u])),
    heads: headIdSet(users),
    changesByProfile: buildChangesByProfile(teamChanges),
  }), [users, teamChanges])

  const prevRange = useMemo(() => (prefs.compare ? getPreviousRange(range.preset, range.from, range.to) : null), [prefs.compare, range])
  const perf = useMemo(
    () => buildPerformance({ deals, leads, activity, users, teamCtx, range, prev: prevRange }),
    [deals, leads, activity, users, teamCtx, range, prevRange]
  )
  const org = perf.org, po = perf.prevOrg
  const floors = { ...DEFAULT_FLOORS, ...(perfFloors || {}) }
  const collapsed = new Set(prefs.collapsed || [])
  const toggleTeam = (key) => setPrefs(p => {
    const s = new Set(p.collapsed || []); s.has(key) ? s.delete(key) : s.add(key); return { ...p, collapsed: [...s] }
  })
  const setAll = (collapse) => setPrefs(p => ({ ...p, collapsed: collapse ? perf.teams.map(t => t.key) : [] }))
  const cmp = (v, f) => (po ? f(v) : undefined)
  // Rep commission is money — admins and the VP see it; managers/directors see
  // production only (their own pay lives on the Commissions page).
  const showCommission = isAdmin || profile?.role === 'vp'

  if (loading) return <div className="p-6 text-white/40 text-sm">Loading performance…</div>

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1280px] mx-auto">
      {/* Sticky controls */}
      {/* Sticky on desktop only — on a phone the bar is taller than the screen's worth of content it would pin over. */}
      <div className="md:sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-3 pb-3" style={{ background: 'rgba(20,20,20,0.96)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #262626' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[20px] font-extrabold text-white mr-1">Performance</h1>
          <DateRangeFilter from={range.from} to={range.to} preset={range.preset} presets={RANGE_PRESETS}
            onChange={r => setRange({ from: r.from, to: r.to, preset: r.preset })} showCustom={false} />
          <button onClick={() => setPrefs(p => ({ ...p, compare: !p.compare }))}
            className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white">
            <span className="inline-block w-7 h-4 rounded-full relative transition-colors" style={{ background: prefs.compare ? '#00b894' : '#3a3a3a' }}>
              <span className="absolute top-[2px] w-3 h-3 rounded-full bg-[#141414] transition-all" style={{ left: prefs.compare ? 14 : 2 }} />
            </span>
            Compare to previous period
          </button>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input type="date" value={range.from || ''} onChange={e => setRange({ from: e.target.value, to: range.to, preset: 'custom' })}
              className="h-7 px-2 rounded-lg text-[11px] text-white focus:outline-none" style={{ background: '#1e1e1e', border: '1px solid #333' }} />
            <span className="text-white/25 text-[11px]">→</span>
            <input type="date" value={range.to || ''} onChange={e => setRange({ from: range.from, to: e.target.value, preset: 'custom' })}
              className="h-7 px-2 rounded-lg text-[11px] text-white focus:outline-none" style={{ background: '#1e1e1e', border: '1px solid #333' }} />
            {isAdmin && (
              <>
                <ImportActivity users={users} onDone={loadData} />
                <button onClick={() => setShowFloors(s => !s)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white" style={{ border: '1px solid #333' }}>
                  <SlidersHorizontal size={12} /> Floors
                </button>
              </>
            )}
          </div>
        </div>
        {perf.teams.length > 1 && (
          <div className="hidden md:flex items-center gap-1.5 flex-wrap mt-2">
            <span className="text-[10px] text-white/25 mr-1">Jump to</span>
            {perf.teams.map(t => (
              <a key={t.key} href={`#team-${t.key}`} className="px-2 py-0.5 rounded-md text-[10.5px] text-white/50 hover:text-white" style={{ border: '1px solid #2a2a2a' }}>
                {t.label}
              </a>
            ))}
            <button onClick={() => setAll(collapsed.size < perf.teams.length)} className="ml-auto text-[10.5px] text-white/35 hover:text-white">
              {collapsed.size < perf.teams.length ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}
      </div>

      {showFloors && isAdmin && (
        <FloorsEditor floors={perfFloors} onClose={() => setShowFloors(false)}
          onSave={async (f) => { const r = await save('perf_floors', f); if (r?.error) toast.error('Could not save floors: ' + r.error.message); else { toast.success('Floors saved'); setShowFloors(false) } }} />
      )}

      {/* Data quality */}
      {(!perf.hasActivity || perf.unmatched.length > 0) && (
        <div className="rounded-xl px-4 py-2.5 flex items-start gap-2.5 text-[12px]" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)' }}>
          <AlertTriangle size={14} className="text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="text-amber-200/90 space-y-0.5">
            {!perf.hasActivity && (
              <p>No door-knock data in this range yet. Field activity columns show "—" until the RepCard activity feed is connected
                {isAdmin ? <> (<Link to="/admin" className="underline">Admin → Settings → Field Activity Feed</Link>) or a report is imported with <span className="font-semibold">Import field CSV</span>.</> : '.'}
              </p>
            )}
            {perf.unmatched.length > 0 && (
              <p>Door knocks arrived for {perf.unmatched.length} name{perf.unmatched.length === 1 ? '' : 's'} not on the roster:{' '}
                <span className="text-amber-100">{perf.unmatched.slice(0, 6).map(u => `${u.name} (${u.doors})`).join(', ')}{perf.unmatched.length > 6 ? '…' : ''}</span>.
                Their doors count in the org total but on no team.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Org scoreboard ── */}
      <section>
        <div className="flex items-baseline gap-3 flex-wrap mb-2.5">
          <h2 className="text-[15px] font-extrabold text-white">Org Scoreboard</h2>
          <span className="text-[11px] text-white/35">{fmtRangeLabel(range.from, range.to)}{prevRange ? ` · vs ${fmtRangeLabel(prevRange.from, prevRange.to)}` : ''}</span>
        </div>
        <div className={`grid grid-cols-2 md:grid-cols-3 ${showCommission ? 'xl:grid-cols-6' : 'xl:grid-cols-5'} gap-2.5`}>
          <Tile label="Revenue" source="site" value={money0(org.revenue)} sub={<Delta cur={org.revenue} prev={po?.revenue} prevText={cmp(po?.revenue, money0)} />} />
          {goalMonth && (
            <Tile label="Monthly goal" value={goal ? `${Math.round((org.revenue / goal) * 100)}%` : '—'}
              sub={<span className="text-[11px] text-white/25">{goal ? `of ${money0(goal)}` : 'No goal set for this month'}</span>}>
              {goal > 0 && (
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#ffffff12' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (org.revenue / goal) * 100)}%`, background: '#2dd4bf' }} />
                </div>
              )}
            </Tile>
          )}
          <Tile label="Deals sold" source="site" value={int0(org.deals)} sub={<Delta cur={org.deals} prev={po?.deals} prevText={cmp(po?.deals, int0)} />} />
          <Tile label="Avg deal size" value={money0(org.avgDeal)} sub={<Delta cur={org.avgDeal} prev={po?.avgDeal} prevText={cmp(po?.avgDeal, money0)} />} />
          <Tile label="Avg markup" value={pct1(org.markupPct)} sub={<Delta cur={org.markupPct} prev={po?.markupPct} rate prevText={cmp(po?.markupPct, pct1)} />} />
          {showCommission && (
            <Tile label="Rep commissions" source="site" value={money0(org.commission)} sub={<Delta cur={org.commission} prev={po?.commission} prevText={cmp(po?.commission, money0)} />} />
          )}
        </div>

        {/* By office */}
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30 mt-4 mb-2">By office</p>
        {perf.offices.length === 0 ? (
          <p className="text-[12px] text-white/30">No deals in this range.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {perf.offices.map(o => (
              <div key={o.key || 'none'} className="rounded-xl px-3.5 py-3" style={CARD}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[13px] font-extrabold ${o.key ? 'text-white' : 'text-white/50'}`}>{o.name}</span>
                  <span className="text-[11px] text-white/40 tabular-nums">{Math.round(o.share * 100)}% of revenue</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2 text-[12px]">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/30 self-center">Deals</span>
                  <span className="text-right text-white font-semibold tabular-nums">{o.deals}{o.prev && <span className="ml-2"><Delta cur={o.deals} prev={o.prev.deals} /></span>}</span>
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/30 self-center">Revenue</span>
                  <span className="text-right text-white font-semibold tabular-nums">{money0(o.revenue)}{o.prev && <span className="ml-2"><Delta cur={o.revenue} prev={o.prev.revenue} /></span>}</span>
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/30 self-center">Avg markup</span>
                  <span className="text-right text-white font-semibold tabular-nums">{pct1(o.markupPct)}{o.prev && <span className="ml-2"><Delta cur={o.markupPct} prev={o.prev.markupPct} rate /></span>}</span>
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/30 self-center">Avg deal</span>
                  <span className="text-right text-white font-semibold tabular-nums">{money0(o.avgDeal)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-2.5" style={{ background: '#ffffff12' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round(o.share * 100)}%`, background: '#2dd4bf' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Appointments & field */}
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30 mt-4 mb-2 flex items-center gap-1.5">Appointments &amp; field <SourceTag kind="repcard" /></p>
        <div className="grid grid-cols-2 md:grid-cols-5 rounded-xl overflow-hidden" style={CARD}>
          {[
            { l: 'Doors knocked', v: org.hasActivity ? int0(org.doors) : '—', s: org.hasActivity ? <Delta cur={org.doors} prev={po?.doors} prevText={cmp(po?.doors, int0)} /> : <span className="text-[11px] text-white/25">feed not connected</span> },
            { l: 'Appointments set', v: int0(org.set), s: <Delta cur={org.set} prev={po?.set} prevText={cmp(po?.set, int0)} /> },
            { l: 'Ran', v: int0(org.ran), s: <span className="text-[11px] text-white/35">{org.showRate != null ? `${Math.round(org.showRate)}% of set` : ''} {po && <Delta cur={org.ran} prev={po.ran} />}</span> },
            { l: 'Sold', v: int0(org.sold), s: <span className="text-[11px] text-white/35">{org.closeRate != null ? `${Math.round(org.closeRate)}% close rate` : ''} {po && <Delta cur={org.sold} prev={po.sold} />}</span> },
            { l: 'Self-gen / Leads ran', v: `${org.sgRan} / ${org.leadRan}`, s: <span className="text-[11px] text-white/25">ran, by who set it</span> },
          ].map((x, i) => (
            <div key={x.l} className="px-3.5 py-3 min-w-0" style={{ borderLeft: i ? '1px solid #2a2a2a' : 'none' }}>
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">{x.l}</p>
              <p className="text-[18px] font-extrabold text-white mt-0.5 tabular-nums">{x.v}</p>
              <div className="mt-0.5 min-h-[14px]">{x.s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Teams ── */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-[15px] font-extrabold text-white">Teams</h2>
          <span className="text-[11px] text-white/35">Membership follows the sale date, same as the Dashboard · sorted by revenue · red = below floor</span>
        </div>
        {perf.teams.length === 0 && <p className="text-[12px] text-white/30">No teams to show.</p>}
        {perf.teams.map(t => (
          <TeamSection key={t.key} team={t} collapsed={collapsed.has(t.key)} onToggle={() => toggleTeam(t.key)}
            isAdmin={isAdmin} floors={floors} showCommission={showCommission} />
        ))}
      </section>

      <p className="text-[10.5px] text-white/25 flex items-center gap-1.5"><Settings2 size={11} />
        Revenue is baseline revenue; canceled deals never count. Set / Ran / Sold are appointments from the RepCard feed. Commission is each rep's own share only.
      </p>
    </div>
  )
}
