import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, Search, Link2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchLeads, fetchUsers, updateLead } from '../lib/db'
import { getPresetRange, presetLabel } from '../utils/dateRanges'
import DateRangeFilter from '../components/DateRangeFilter'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { toast } from '../lib/toast'

// The lifecycle the site reasons about (migration 041). RUN = the appointment
// actually happened, which is what counts as an estimate.
const STATUSES = [
  { key: 'scheduled', label: 'Scheduled', color: '#74b9ff' },
  { key: 'completed', label: 'Ran',       color: '#00b894' },
  { key: 'sold',      label: 'Sold',      color: '#4ade80' },
  { key: 'no_show',   label: 'No Show',   color: '#fb923c' },
  { key: 'canceled',  label: 'Canceled',  color: '#6b7280' },
]
const stat = (k) => STATUSES.find(s => s.key === k) ?? { label: k || '—', color: '#6b7280' }
const RAN = new Set(['completed', 'sold'])   // an estimate was run
const dt = (iso) => iso ? format(new Date(iso), 'EEE, MMM d · h:mma') : '—'

function Kpi({ label, value, sub, color = '#00b894' }) {
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0 flex-1" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">{label}</p>
      <p className="text-[17px] md:text-[21px] font-bold leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-white/30 mt-1">{sub}</p>}
    </div>
  )
}

export default function Leads() {
  const { profile, isAdmin } = useAuth()
  const role = profile?.role ?? 'rep'
  const [leads, setLeads] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const initial = getPresetRange('mtd')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo]     = useState(initial.to)
  const [preset, setPreset]     = useState('mtd')
  const [search, setSearch]     = useState('')
  const [repFilter, setRepFilter]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = () => Promise.all([fetchLeads(), fetchUsers()])
    .then(([l, u]) => { setLeads(l.data ?? []); setUsers(u.data ?? []) })
  useEffect(() => { load().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(load)

  // A rep only sees appointments they set or are running.
  const mine = (l) => l.setter_id === profile?.id || l.closer_id === profile?.id
  const scoped = useMemo(
    () => (role === 'rep' && !isAdmin) ? leads.filter(mine) : leads,
    [leads, role, isAdmin, profile?.id])

  const dayOf = (l) => (l.appointment_at ? String(l.appointment_at).slice(0, 10) : '')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(l => {
      const d = dayOf(l)
      if (dateFrom && d && d < dateFrom) return false
      if (dateTo && d && d > dateTo) return false
      if (statusFilter && l.status !== statusFilter) return false
      if (repFilter && l.setter_id !== repFilter && l.closer_id !== repFilter) return false
      if (q) {
        const hay = [l.customer_name, l.address, l.setter?.name, l.closer?.name, l.setter_name, l.closer_name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => String(b.appointment_at ?? '').localeCompare(String(a.appointment_at ?? '')))
  }, [scoped, dateFrom, dateTo, statusFilter, repFilter, search])

  const kpis = useMemo(() => {
    const set = filtered.length
    const ran = filtered.filter(l => RAN.has(l.status)).length
    const sold = filtered.filter(l => l.status === 'sold').length
    const noShow = filtered.filter(l => l.status === 'no_show').length
    return {
      set, ran, sold, noShow,
      closeRate: ran > 0 ? (sold / ran) * 100 : null,
      showRate: set - filtered.filter(l => l.status === 'canceled').length > 0
        ? (ran / (set - filtered.filter(l => l.status === 'canceled').length)) * 100 : null,
    }
  }, [filtered])

  // Per-rep funnel for the period — the automatic replacement for the
  // hand-entered Weekly Stats estimates.
  const byRep = useMemo(() => {
    const m = {}
    const row = (id, name) => (m[id] ??= { id, name, set: 0, ran: 0, sold: 0 })
    for (const l of filtered) {
      const id = l.setter_id || l.closer_id
      if (!id) continue
      const name = l.setter?.name || l.closer?.name || l.setter_name || l.closer_name || 'Unknown'
      const r = row(id, name)
      r.set += 1
      if (RAN.has(l.status)) r.ran += 1
      if (l.status === 'sold') r.sold += 1
    }
    return Object.values(m)
      .filter(r => isAdmin || !users.find(u => u.id === r.id)?.ghost)
      .sort((a, b) => b.ran - a.ran || b.set - a.set)
  }, [filtered, users, isAdmin])

  // Any admin correction PINS the row so the CRM feed can't revert it (the
  // feed keeps refreshing timing/details; status + people stay ours).
  async function patchLead(l, patch) {
    const withPin = { ...patch, pinned: true }
    setLeads(ls => ls.map(x => x.id === l.id ? { ...x, ...withPin } : x))
    const res = await updateLead(l.id, withPin)
    if (res?.error) { toast.error('Could not update: ' + (res.error.message || 'unknown error')); load() }
  }
  const setStatus = (l, status) => patchLead(l, { status })
  function setPerson(l, field, id) {
    const u = users.find(x => x.id === id)
    patchLead(l, { [field]: id || null, [`${field.replace('_id', '')}_name`]: u?.name ?? null })
  }
  async function unpin(l) {
    setLeads(ls => ls.map(x => x.id === l.id ? { ...x, pinned: false } : x))
    const res = await updateLead(l.id, { pinned: false })
    if (res?.error) { toast.error('Could not unpin: ' + (res.error.message || 'unknown error')); load() }
    else toast.info('Handed back to the CRM feed — it can update this appointment again.')
  }

  const pickUsers = useMemo(
    () => users.filter(u => u.active !== false && (isAdmin || !u.ghost)).sort((a, b) => a.name.localeCompare(b.name)),
    [users, isAdmin])
  const selCls = 'h-8 px-2 rounded-lg text-[12px] text-white focus:outline-none'
  const selStyle = { background: '#242424', border: '1px solid #333' }

  if (loading) return <div className="p-8 text-white/40 text-sm">Loading…</div>

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
          <CalendarCheck size={18} className="text-teal" /> Leads
        </h1>
        <p className="text-[12px] text-white/40 mt-0.5">
          Appointments fed in from the field CRM. An appointment that RAN counts as an estimate.
        </p>
      </div>

      {leads.length === 0 && (
        <div className="rounded-xl px-4 py-3 text-[12px]"
          style={{ background: 'rgba(116,185,255,0.07)', border: '1px solid rgba(116,185,255,0.3)', color: '#bcdcff' }}>
          No appointments yet — this fills in automatically once the CRM feed is connected.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter from={dateFrom} to={dateTo} preset={preset}
          onChange={({ from, to, preset }) => { setDateFrom(from); setDateTo(to); setPreset(preset) }}
          count={filtered.length} countLabel="appointments" />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, address, rep…"
            style={selStyle} className={`${selCls} pl-7 w-[200px]`} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selStyle} className={selCls}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {(role !== 'rep' || isAdmin) && (
          <select value={repFilter} onChange={e => setRepFilter(e.target.value)} style={selStyle} className={`${selCls} max-w-[180px]`}>
            <option value="">All reps</option>
            {pickUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 md:flex gap-2 md:gap-3">
        <Kpi label="Appointments Set" value={kpis.set} color="#74b9ff" />
        <Kpi label="Ran (Estimates)"  value={kpis.ran} sub={kpis.showRate != null ? `${kpis.showRate.toFixed(0)}% show rate` : undefined} />
        <Kpi label="Sold"             value={kpis.sold} color="#4ade80" />
        <Kpi label="Close Rate"       value={kpis.closeRate == null ? '—' : `${kpis.closeRate.toFixed(0)}%`} sub="sold ÷ ran" color="#a78bfa" />
        <Kpi label="No Shows"         value={kpis.noShow} color="#fb923c" />
      </div>

      {byRep.length > 0 && (
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <h3 className="text-[13px] font-semibold text-white mb-0.5">By Rep — {presetLabel(preset)}</h3>
          <p className="text-[10px] text-white/30 mb-3">Set → ran → sold. "Ran" is the estimate count these will replace the manual entry with.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[440px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-widest text-white/30">
                  <th className="pb-2 pr-3">Rep</th>
                  <th className="pb-2 pr-3 text-right">Set</th>
                  <th className="pb-2 pr-3 text-right">Ran</th>
                  <th className="pb-2 pr-3 text-right">Sold</th>
                  <th className="pb-2 text-right">Close %</th>
                </tr>
              </thead>
              <tbody>
                {byRep.map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: '#2a2a2a' }}>
                    <td className="py-2 pr-3 font-semibold text-white whitespace-nowrap">{r.name}</td>
                    <td className="py-2 pr-3 text-right text-white/70">{r.set}</td>
                    <td className="py-2 pr-3 text-right text-teal font-semibold">{r.ran}</td>
                    <td className="py-2 pr-3 text-right text-white">{r.sold}</td>
                    <td className="py-2 text-right text-white/60">{r.ran > 0 ? `${Math.round((r.sold / r.ran) * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-white/30">No appointments in this range.</p>
        ) : filtered.map(l => {
          const s = stat(l.status)
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-white/5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white truncate">
                  {l.customer_name || 'Unnamed'}
                  {l.deal_id && <Link2 size={11} className="inline ml-1.5 text-teal/70" title="Linked to a deal" />}
                </p>
                <p className="text-[10.5px] text-white/35 truncate">
                  {l.address || 'No address'}
                  {l.office ? ` · ${l.office}` : ''}
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-col gap-1 min-w-[168px]">
                  {[['setter_id', 'SET', l.setter_id], ['closer_id', 'RUN', l.closer_id]].map(([field, tag, val]) => (
                    <span key={field} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-white/25 w-6">{tag}</span>
                      <select value={val || ''} onChange={e => setPerson(l, field, e.target.value)}
                        style={{ background: '#242424', border: '1px solid #333' }}
                        className="h-6 px-1.5 rounded text-[11px] text-white/80 focus:outline-none max-w-[136px]"
                        title={tag === 'SET' ? 'Who booked it' : 'Who runs it (reassign here)'}>
                        <option value="">— none —</option>
                        {pickUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-white/45 whitespace-nowrap min-w-[150px]">
                  <span className="text-white/25">SET</span> {l.setter?.name || l.setter_name || '—'}
                  {(l.closer?.name || l.closer_name) && (l.closer_id !== l.setter_id) && (
                    <><br /><span className="text-white/25">RUN</span> {l.closer?.name || l.closer_name}</>
                  )}
                </div>
              )}
              <div className="text-[11px] text-white/50 whitespace-nowrap min-w-[150px]">{dt(l.appointment_at)}</div>
              {isAdmin ? (
                <select value={l.status} onChange={e => setStatus(l, e.target.value)}
                  style={{ background: '#242424', border: `1px solid ${s.color}55`, color: s.color }}
                  className="h-7 px-2 rounded-full text-[11px] font-semibold focus:outline-none">
                  {STATUSES.map(x => <option key={x.key} value={x.key} style={{ color: '#fff' }}>{x.label}</option>)}
                </select>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ color: s.color, border: `1px solid ${s.color}40` }}>{s.label}</span>
              )}
              {isAdmin && l.pinned && (
                <button onClick={() => unpin(l)} title="Edited here — the CRM feed can't change the status or people. Click to hand it back."
                  className="text-[9px] font-bold uppercase tracking-wide text-amber-400/80 hover:text-amber-300">
                  edited
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
