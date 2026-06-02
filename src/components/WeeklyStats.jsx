import { useEffect, useMemo, useState } from 'react'
import { Check, X, Pencil, Target, ClipboardList, Percent } from 'lucide-react'
import { fetchWeeklyStats, upsertWeeklyStat } from '../lib/db'
import DateRangeFilter from './DateRangeFilter'
import {
  getPresetRange, weeksInRange, weekStartOf, matchPreset, rangeMatches, presetLabel,
} from '../utils/dateRanges'

// Close-rate colour tiers (estimates → closed deals).
function rateColor(rate) {
  if (rate == null) return '#6b7280'
  if (rate >= 40)   return '#4ade80'
  if (rate >= 25)   return '#fbbf24'
  return '#fb923c'
}

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

export default function WeeklyStats({ deals = [], reps = [], canEdit = false, profileId }) {
  const initial = getPresetRange('last_week')
  const [from,    setFrom]    = useState(initial.from)
  const [to,      setTo]      = useState(initial.to)
  const [preset,  setPreset]  = useState('last_week')
  const [stats,   setStats]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // `${repId}|${weekStart}`
  const [draft,   setDraft]   = useState('')

  useEffect(() => {
    fetchWeeklyStats().then(({ data }) => { setStats(data ?? []); setLoading(false) })
  }, [])

  const activePreset = rangeMatches(preset, from, to) ? preset : matchPreset(from, to)
  const weeks  = useMemo(() => weeksInRange(from, to), [from, to])
  const singleWeek = weeks.length === 1 ? weeks[0] : null
  const editable   = canEdit && !!singleWeek

  // estimates: keyed `${repId}|${weekStart}` → number
  const estMap = useMemo(() => {
    const m = {}
    for (const s of stats) m[`${s.rep_id}|${s.week_start}`] = Number(s.estimates) || 0
    return m
  }, [stats])

  // closed deals (deals the rep SET, by sale week): `${repId}|${weekStart}` → count
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

  const rows = useMemo(() => {
    return reps.map(rep => {
      let estimates = 0, closed = 0
      for (const w of weeks) {
        estimates += estMap[`${rep.id}|${w.weekStart}`] || 0
        closed    += closedMap[`${rep.id}|${w.weekStart}`] || 0
      }
      const rate = estimates > 0 ? (closed / estimates) * 100 : null
      return { id: rep.id, name: rep.name, estimates, closed, rate }
    }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.closed - a.closed || b.estimates - a.estimates)
  }, [reps, weeks, estMap, closedMap])

  const totals = useMemo(() => {
    const est    = rows.reduce((s, r) => s + r.estimates, 0)
    const closed = rows.reduce((s, r) => s + r.closed, 0)
    return { est, closed, rate: est > 0 ? (closed / est) * 100 : null }
  }, [rows])

  function startEdit(repId) {
    if (!editable) return
    setEditing(`${repId}|${singleWeek.weekStart}`)
    setDraft(String(estMap[`${repId}|${singleWeek.weekStart}`] || ''))
  }

  async function saveEdit(repId) {
    const weekStart = singleWeek.weekStart
    const v = Math.max(0, parseInt(draft, 10) || 0)
    const { error } = await upsertWeeklyStat({ rep_id: repId, week_start: weekStart, estimates: v }, profileId)
    if (!error) {
      setStats(prev => [
        ...prev.filter(s => !(s.rep_id === repId && s.week_start === weekStart)),
        { rep_id: repId, week_start: weekStart, estimates: v },
      ])
    }
    setEditing(null)
  }

  const periodLabel = singleWeek
    ? `Week of ${singleWeek.label}`
    : `${presetLabel(activePreset)} · ${weeks.length} weeks`

  return (
    <div className="space-y-4">
      <DateRangeFilter from={from} to={to} preset={preset}
        onChange={({ from, to, preset }) => { setFrom(from); setTo(to); setPreset(preset); setEditing(null) }} />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-white/70">{periodLabel}</span>
        {!singleWeek && (
          <span className="text-[11px] text-white/30">— select a single week to edit estimates</span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 md:flex md:gap-3">
        <Kpi icon={ClipboardList} label="Estimates" value={totals.est} color="#74b9ff" />
        <Kpi icon={Target}        label="Closed"    value={totals.closed} />
        <Kpi icon={Percent}       label="Close Rate" color={rateColor(totals.rate)}
          value={totals.rate == null ? '—' : `${totals.rate.toFixed(0)}%`} />
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
        <div className="px-4 md:px-5 py-3.5 border-b border-white/5 flex items-baseline gap-3">
          <h3 className="text-[13px] font-bold text-white">Rep Close Rate</h3>
          <p className="text-[11px] text-white/30 hidden sm:block">Closed deals auto-pulled from sales · estimates entered manually</p>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-white/30 text-[13px]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-white/30 text-[13px]">No reps in view for your role.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#1e1e1e' }} className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                  <th className="px-2 sm:px-4 py-2.5 text-left w-8">#</th>
                  <th className="px-2 sm:px-4 py-2.5 text-left">Rep</th>
                  <th className="px-2 sm:px-4 py-2.5 text-center">Est.</th>
                  <th className="px-2 sm:px-4 py-2.5 text-center">Closed</th>
                  <th className="px-2 sm:px-4 py-2.5 text-right">Close Rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rep, i) => {
                  const key = `${rep.id}|${singleWeek?.weekStart}`
                  const isEditing = editing === key
                  return (
                    <tr key={rep.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-2 sm:px-4 py-3 text-[11px] font-bold text-white/30">{i + 1}</td>
                      <td className="px-2 sm:px-4 py-3 text-[12px] font-medium text-white/85 truncate max-w-[120px] sm:max-w-[200px]">{rep.name}</td>
                      <td className="px-2 sm:px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <input autoFocus type="number" min="0" value={draft}
                              onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(rep.id); if (e.key === 'Escape') setEditing(null) }}
                              className="w-14 rounded px-2 py-1 text-[12px] font-bold text-teal text-center focus:outline-none"
                              style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.4)' }} />
                            <button onClick={() => saveEdit(rep.id)} className="text-emerald-400 p-0.5"><Check size={14} /></button>
                            <button onClick={() => setEditing(null)} className="text-white/30 p-0.5"><X size={14} /></button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(rep.id)}
                            disabled={!editable}
                            className={`inline-flex items-center gap-1 text-[13px] font-semibold text-white ${editable ? 'hover:text-teal group cursor-pointer' : 'cursor-default'}`}
                          >
                            {rep.estimates}
                            {editable && <Pencil size={11} className="text-white/15 group-hover:text-teal/60" />}
                          </button>
                        )}
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-center text-[13px] font-semibold text-white/80">{rep.closed}</td>
                      <td className="px-2 sm:px-4 py-3 text-right">
                        <span className="text-[13px] font-bold" style={{ color: rateColor(rep.rate) }}>
                          {rep.rate == null ? '—' : `${rep.rate.toFixed(0)}%`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
