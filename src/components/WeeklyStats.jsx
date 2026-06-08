import { useEffect, useMemo, useState } from 'react'
import { Percent, AlertTriangle } from 'lucide-react'
import { fetchWeeklyStats, upsertWeeklyStat } from '../lib/db'
import { isCanceled } from '../utils/commission'
import DateRangeFilter from './DateRangeFilter'
import {
  getPresetRange, weeksInRange, weekStartOf, matchPreset, rangeMatches, presetLabel,
} from '../utils/dateRanges'

function rateColor(rate) {
  if (rate == null) return '#6b7280'
  if (rate >= 40)   return '#4ade80'
  if (rate >= 25)   return '#fbbf24'
  return '#fb923c'
}
const pct = (r) => (r == null ? '—' : `${r.toFixed(0)}%`)
const rate = (closed, est) => (est > 0 ? (closed / est) * 100 : null)

function Kpi({ label, est, closed, color = '#00b894' }) {
  const r = rate(closed, est)
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0 md:flex-1" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-[16px] md:text-[20px] font-bold leading-none" style={{ color: rateColor(r) }}>{pct(r)}</p>
      <p className="text-[10px] text-white/30 mt-1">{closed}/{est} closed</p>
    </div>
  )
}

export default function WeeklyStats({ deals = [], reps = [], users = [], canEdit = false, profileId }) {
  const initial = getPresetRange('last_week')
  const [from,    setFrom]    = useState(initial.from)
  const [to,      setTo]      = useState(initial.to)
  const [preset,  setPreset]  = useState('last_week')
  const [stats,   setStats]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetchWeeklyStats().then(({ data }) => { setStats(data ?? []); setLoading(false) })
  }, [])

  const activePreset = rangeMatches(preset, from, to) ? preset : matchPreset(from, to)
  const weeks      = useMemo(() => weeksInRange(from, to), [from, to])
  const singleWeek = weeks.length === 1 ? weeks[0] : null
  const editable   = canEdit && !!singleWeek

  // Manual estimate inputs, keyed rep|week.
  const sgEstMap = useMemo(() => {
    const m = {}; for (const s of stats) m[`${s.rep_id}|${s.week_start}`] = Number(s.self_gen_estimates) || 0; return m
  }, [stats])
  const ldEstMap = useMemo(() => {
    const m = {}; for (const s of stats) m[`${s.rep_id}|${s.week_start}`] = Number(s.lead_estimates) || 0; return m
  }, [stats])

  // Closes from deals, bucketed by sale week:
  //  • self-gen close = a deal the rep SET that sold (credited to the setter,
  //    even if a different rep closed it)
  //  • lead close     = a deal the rep CLOSED that someone else set
  const { sgClosed, ldClosed } = useMemo(() => {
    const wk = new Set(weeks.map(w => w.weekStart))
    const sc = {}, lc = {}
    for (const d of deals) {
      if (!d.sale_date || isCanceled(d)) continue
      const ws = weekStartOf(d.sale_date)
      if (!wk.has(ws)) continue
      const setter = d.setter_id, closer = d.closer_id
      if (setter) sc[`${setter}|${ws}`] = (sc[`${setter}|${ws}`] || 0) + 1
      if (closer && closer !== setter) lc[`${closer}|${ws}`] = (lc[`${closer}|${ws}`] || 0) + 1
    }
    return { sgClosed: sc, ldClosed: lc }
  }, [deals, weeks])

  const rowFor = (rep) => {
    let sgEst = 0, sgCl = 0, ldEst = 0, ldCl = 0
    for (const w of weeks) {
      sgEst += sgEstMap[`${rep.id}|${w.weekStart}`] || 0
      ldEst += ldEstMap[`${rep.id}|${w.weekStart}`] || 0
      sgCl  += sgClosed[`${rep.id}|${w.weekStart}`] || 0
      ldCl  += ldClosed[`${rep.id}|${w.weekStart}`] || 0
    }
    return {
      id: rep.id, name: rep.name, manager_id: rep.manager_id,
      sgEst, sgCl, sgRate: rate(sgCl, sgEst),
      ldEst, ldCl, ldRate: rate(ldCl, ldEst),
      totEst: sgEst + ldEst, totCl: sgCl + ldCl, totRate: rate(sgCl + ldCl, sgEst + ldEst),
    }
  }

  // Group visible reps by manager into teams (with subtotals).
  const teams = useMemo(() => {
    const nameOf = (id) => users.find(u => u.id === id)?.name
    const groups = {}
    for (const rep of reps) {
      const mid = rep.manager_id || 'unassigned'
      if (!groups[mid]) groups[mid] = { id: mid, name: mid === 'unassigned' ? 'Unassigned' : (nameOf(mid) ? `${nameOf(mid)}'s Team` : 'Team'), rows: [] }
      groups[mid].rows.push(rowFor(rep))
    }
    const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0)
    const list = Object.values(groups).map(g => {
      g.rows.sort((a, b) => (b.totRate ?? -1) - (a.totRate ?? -1) || b.totCl - a.totCl)
      const sgEst = sum(g.rows, 'sgEst'), sgCl = sum(g.rows, 'sgCl')
      const ldEst = sum(g.rows, 'ldEst'), ldCl = sum(g.rows, 'ldCl')
      return { ...g, sgEst, sgCl, sgRate: rate(sgCl, sgEst), ldEst, ldCl, ldRate: rate(ldCl, ldEst),
        totEst: sgEst + ldEst, totCl: sgCl + ldCl, totRate: rate(sgCl + ldCl, sgEst + ldEst) }
    })
    list.sort((a, b) => (b.totRate ?? -1) - (a.totRate ?? -1) || b.totCl - a.totCl)
    return list
  }, [reps, users, weeks, sgEstMap, ldEstMap, sgClosed, ldClosed])

  const totals = useMemo(() => {
    const s = (k) => teams.reduce((acc, t) => acc + t[k], 0)
    return { sgEst: s('sgEst'), sgCl: s('sgCl'), ldEst: s('ldEst'), ldCl: s('ldCl') }
  }, [teams])

  // Save one estimate field for a rep in the (single) selected week — writes both
  // self-gen and lead so the row stays consistent.
  async function saveEst(repId, which, raw) {
    if (!singleWeek) return
    const ws = singleWeek.weekStart
    const v = Math.max(0, parseInt(raw, 10) || 0)
    const cur = stats.find(s => s.rep_id === repId && s.week_start === ws) || {}
    const sg = which === 'sg' ? v : (Number(cur.self_gen_estimates) || 0)
    const ld = which === 'ld' ? v : (Number(cur.lead_estimates) || 0)
    setError('')
    setStats(prev => [
      ...prev.filter(s => !(s.rep_id === repId && s.week_start === ws)),
      { rep_id: repId, week_start: ws, self_gen_estimates: sg, lead_estimates: ld, estimates: sg + ld },
    ])
    const { error } = await upsertWeeklyStat({ rep_id: repId, week_start: ws, self_gen_estimates: sg, lead_estimates: ld }, profileId)
    if (error) setError(`Couldn't save: ${error.message}. (Has migration 018 been run?)`)
  }

  const periodLabel = singleWeek ? `Week of ${singleWeek.label}` : `${presetLabel(activePreset)} · ${weeks.length} weeks`

  // shared cell classes
  const th = 'px-2 sm:px-3 py-2 text-[10px] font-bold text-white/30 uppercase tracking-wider whitespace-nowrap'
  const td = 'px-2 sm:px-3 py-2.5 text-[12px] whitespace-nowrap'

  const EstCell = ({ repId, which, value }) => editable ? (
    <input type="number" min="0" defaultValue={value} key={`${repId}-${which}-${singleWeek.weekStart}`}
      onBlur={e => saveEst(repId, which, e.target.value)}
      className="w-12 rounded px-1.5 py-1 text-[12px] font-semibold text-teal text-center focus:outline-none"
      style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.35)' }} />
  ) : <span className="text-white/70">{value}</span>

  return (
    <div className="space-y-4">
      <DateRangeFilter from={from} to={to} preset={preset}
        onChange={({ from, to, preset }) => { setFrom(from); setTo(to); setPreset(preset) }} />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-white/70">{periodLabel}</span>
        {!singleWeek && <span className="text-[11px] text-white/30">— select a single week to edit estimates</span>}
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2 text-[12px] text-red-300"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {/* Overall close-rate KPIs */}
      <div className="grid grid-cols-3 gap-2 md:flex md:gap-3">
        <Kpi label="Self-gen %" est={totals.sgEst} closed={totals.sgCl} />
        <Kpi label="Lead %"     est={totals.ldEst} closed={totals.ldCl} />
        <Kpi label="Combined %" est={totals.sgEst + totals.ldEst} closed={totals.sgCl + totals.ldCl} />
      </div>

      {loading ? (
        <div className="rounded-xl px-4 py-8 text-white/30 text-[13px]" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>Loading…</div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl px-4 py-8 text-white/30 text-[13px]" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>No reps in view for your role.</div>
      ) : (
        teams.map(team => (
          <div key={team.id} className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <div className="px-4 md:px-5 py-3 border-b border-white/5 flex items-center justify-between gap-3" style={{ background: '#1e1e1e' }}>
              <h3 className="text-[13px] font-bold text-white truncate">{team.name}</h3>
              <div className="flex items-center gap-3 md:gap-5 text-right flex-shrink-0">
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Self-gen</p><p className="text-[13px] font-bold" style={{ color: rateColor(team.sgRate) }}>{pct(team.sgRate)}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Lead</p><p className="text-[13px] font-bold" style={{ color: rateColor(team.ldRate) }}>{pct(team.ldRate)}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Combined</p><p className="text-[13px] font-bold" style={{ color: rateColor(team.totRate) }}>{pct(team.totRate)}</p></div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr style={{ background: '#202020' }}>
                    <th className={`${th} text-left`}>Rep</th>
                    <th className={`${th} text-center`} title="Self-gen estimates">SG Est</th>
                    <th className={`${th} text-center`} title="Self-gen closes">SG Cl</th>
                    <th className={`${th} text-right`}>SG %</th>
                    <th className={`${th} text-center`} title="Lead estimates">Ld Est</th>
                    <th className={`${th} text-center`} title="Leads closed">Ld Cl</th>
                    <th className={`${th} text-right`}>Ld %</th>
                    <th className={`${th} text-right`}>Total %</th>
                  </tr>
                </thead>
                <tbody>
                  {team.rows.map(r => (
                    <tr key={r.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                      <td className={`${td} font-medium text-white/85 truncate max-w-[140px]`}>{r.name}</td>
                      <td className={`${td} text-center`}><EstCell repId={r.id} which="sg" value={r.sgEst} /></td>
                      <td className={`${td} text-center text-white/70`}>{r.sgCl}</td>
                      <td className={`${td} text-right font-bold`} style={{ color: rateColor(r.sgRate) }}>{pct(r.sgRate)}</td>
                      <td className={`${td} text-center`}><EstCell repId={r.id} which="ld" value={r.ldEst} /></td>
                      <td className={`${td} text-center text-white/70`}>{r.ldCl}</td>
                      <td className={`${td} text-right font-bold`} style={{ color: rateColor(r.ldRate) }}>{pct(r.ldRate)}</td>
                      <td className={`${td} text-right font-bold`} style={{ color: rateColor(r.totRate) }}>{pct(r.totRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
