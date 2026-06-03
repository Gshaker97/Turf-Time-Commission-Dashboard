import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Pencil, Target, ClipboardList, Percent, AlertTriangle } from 'lucide-react'
import { fetchWeeklyStats, upsertWeeklyStat } from '../lib/db'
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

function Kpi({ icon: Icon, label, value, color = '#00b894' }) {
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0 md:flex-1" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} style={{ color }} />
        <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-[16px] md:text-[20px] font-bold leading-none truncate" style={{ color }}>{value}</p>
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
  const [editing, setEditing] = useState(null)   // repId (single-week edit)
  const [draft,   setDraft]   = useState('')
  const [error,   setError]   = useState('')
  const skipBlur = useRef(false)

  useEffect(() => {
    fetchWeeklyStats().then(({ data }) => { setStats(data ?? []); setLoading(false) })
  }, [])

  const activePreset = rangeMatches(preset, from, to) ? preset : matchPreset(from, to)
  const weeks      = useMemo(() => weeksInRange(from, to), [from, to])
  const singleWeek = weeks.length === 1 ? weeks[0] : null
  const editable   = canEdit && !!singleWeek

  const estMap = useMemo(() => {
    const m = {}
    for (const s of stats) m[`${s.rep_id}|${s.week_start}`] = Number(s.estimates) || 0
    return m
  }, [stats])

  // closed deals = deals the rep SET, bucketed by sale week
  const closedMap = useMemo(() => {
    const wk = new Set(weeks.map(w => w.weekStart))
    const m = {}
    for (const d of deals) {
      if (!d.setter_id || !d.sale_date) continue
      const ws = weekStartOf(d.sale_date)
      if (!wk.has(ws)) continue
      m[`${d.setter_id}|${ws}`] = (m[`${d.setter_id}|${ws}`] || 0) + 1
    }
    return m
  }, [deals, weeks])

  const rowFor = (rep) => {
    let estimates = 0, closed = 0
    for (const w of weeks) {
      estimates += estMap[`${rep.id}|${w.weekStart}`] || 0
      closed    += closedMap[`${rep.id}|${w.weekStart}`] || 0
    }
    return { id: rep.id, name: rep.name, estimates, closed, rate: estimates > 0 ? (closed / estimates) * 100 : null }
  }

  // Group visible reps by their manager into teams.
  const teams = useMemo(() => {
    const nameOf = (id) => users.find(u => u.id === id)?.name
    const groups = {}
    for (const rep of reps) {
      const mid = rep.manager_id || 'unassigned'
      if (!groups[mid]) {
        groups[mid] = {
          id: mid,
          name: mid === 'unassigned' ? 'Unassigned' : (nameOf(mid) ? `${nameOf(mid)}'s Team` : 'Team'),
          rows: [],
        }
      }
      groups[mid].rows.push(rowFor(rep))
    }
    const list = Object.values(groups).map(g => {
      const est = g.rows.reduce((s, r) => s + r.estimates, 0)
      const closed = g.rows.reduce((s, r) => s + r.closed, 0)
      g.rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.closed - a.closed || b.estimates - a.estimates)
      return { ...g, est, closed, rate: est > 0 ? (closed / est) * 100 : null }
    })
    list.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.closed - a.closed)
    return list
  }, [reps, users, weeks, estMap, closedMap])

  const totals = useMemo(() => {
    const est = teams.reduce((s, t) => s + t.est, 0)
    const closed = teams.reduce((s, t) => s + t.closed, 0)
    return { est, closed, rate: est > 0 ? (closed / est) * 100 : null }
  }, [teams])

  function startEdit(repId, current) {
    if (!editable) return
    setEditing(repId); setDraft(String(current || ''))
  }
  async function commit(repId) {
    const weekStart = singleWeek.weekStart
    const v = Math.max(0, parseInt(draft, 10) || 0)
    setEditing(null); setError('')
    setStats(prev => [
      ...prev.filter(s => !(s.rep_id === repId && s.week_start === weekStart)),
      { rep_id: repId, week_start: weekStart, estimates: v },
    ])
    const { error } = await upsertWeeklyStat({ rep_id: repId, week_start: weekStart, estimates: v }, profileId)
    if (error) setError(`Couldn't save to the database: ${error.message}. (Has migration 005_weekly_stats.sql been run?)`)
  }
  function onBlur(repId) { if (skipBlur.current) { skipBlur.current = false; return } commit(repId) }
  function cancel() { skipBlur.current = true; setEditing(null) }

  const periodLabel = singleWeek
    ? `Week of ${singleWeek.label}`
    : `${presetLabel(activePreset)} · ${weeks.length} weeks`

  return (
    <div className="space-y-4">
      <DateRangeFilter from={from} to={to} preset={preset}
        onChange={({ from, to, preset }) => { setFrom(from); setTo(to); setPreset(preset); setEditing(null) }} />

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

      {/* Overall KPIs */}
      <div className="grid grid-cols-3 gap-2 md:flex md:gap-3">
        <Kpi icon={ClipboardList} label="Estimates" value={totals.est} color="#74b9ff" />
        <Kpi icon={Target}        label="Closed"    value={totals.closed} />
        <Kpi icon={Percent}       label="Close Rate" color={rateColor(totals.rate)} value={pct(totals.rate)} />
      </div>

      {loading ? (
        <div className="rounded-xl px-4 py-8 text-white/30 text-[13px]" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>Loading…</div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl px-4 py-8 text-white/30 text-[13px]" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>No reps in view for your role.</div>
      ) : (
        teams.map(team => (
          <div key={team.id} className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            {/* Team header with subtotals */}
            <div className="px-4 md:px-5 py-3 border-b border-white/5 flex items-center justify-between gap-3"
              style={{ background: '#1e1e1e' }}>
              <h3 className="text-[13px] font-bold text-white truncate">{team.name}</h3>
              <div className="flex items-center gap-4 md:gap-6 text-right flex-shrink-0">
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Est</p><p className="text-[13px] font-bold text-white/80">{team.est}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Closed</p><p className="text-[13px] font-bold text-white/80">{team.closed}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-white/30">Rate</p><p className="text-[13px] font-bold" style={{ color: rateColor(team.rate) }}>{pct(team.rate)}</p></div>
              </div>
            </div>

            <table className="w-full">
              <thead>
                <tr style={{ background: '#202020' }} className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                  <th className="px-2 sm:px-4 py-2 text-left">Rep</th>
                  <th className="px-2 sm:px-4 py-2 text-center">Est.</th>
                  <th className="px-2 sm:px-4 py-2 text-center">Closed</th>
                  <th className="px-2 sm:px-4 py-2 text-right">Close Rate</th>
                </tr>
              </thead>
              <tbody>
                {team.rows.map(rep => (
                  <tr key={rep.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-2 sm:px-4 py-2.5 text-[12px] font-medium text-white/85 truncate max-w-[140px] sm:max-w-[220px]">{rep.name}</td>
                    <td className="px-2 sm:px-4 py-2.5 text-center">
                      {editing === rep.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <input autoFocus type="number" min="0" value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onBlur={() => onBlur(rep.id)}
                            onKeyDown={e => { if (e.key === 'Enter') commit(rep.id); if (e.key === 'Escape') cancel() }}
                            className="w-14 rounded px-2 py-1 text-[12px] font-bold text-teal text-center focus:outline-none"
                            style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.4)' }} />
                          <button onMouseDown={e => e.preventDefault()} onClick={() => commit(rep.id)} className="text-emerald-400 p-0.5"><Check size={14} /></button>
                          <button onMouseDown={e => e.preventDefault()} onClick={cancel} className="text-white/30 p-0.5"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(rep.id, rep.estimates)} disabled={!editable}
                          className={`inline-flex items-center gap-1 text-[13px] font-semibold text-white ${editable ? 'hover:text-teal group cursor-pointer' : 'cursor-default'}`}>
                          {rep.estimates}
                          {editable && <Pencil size={11} className="text-white/15 group-hover:text-teal/60" />}
                        </button>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 text-center text-[13px] font-semibold text-white/80">{rep.closed}</td>
                    <td className="px-2 sm:px-4 py-2.5 text-right text-[13px] font-bold" style={{ color: rateColor(rep.rate) }}>{pct(rep.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}
