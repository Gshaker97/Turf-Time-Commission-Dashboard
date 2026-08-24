import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, Search, Link2, Upload, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchLeads, fetchUsers, updateLead, upsertLeads } from '../lib/db'
import { csvToLeads } from '../utils/leadImport'
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
    // Chronological — the list reads like the calendar it came from.
    }).sort((a, b) => String(a.appointment_at ?? '').localeCompare(String(b.appointment_at ?? '')))
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
  // ── CSV backfill ──────────────────────────────────────────
  // The webhook only fires on events from the moment it's configured, so
  // already-scheduled appointments need one import. Keyed on the appointment
  // id like the feed, so re-importing (or overlapping date ranges) updates
  // rather than duplicates.
  const [importOpen, setImportOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const profilesByEmail = useMemo(() => Object.fromEntries(
    users.filter(u => u.email).map(u => [String(u.email).toLowerCase(), u.id])), [users])
  const preview = useMemo(
    () => (csvText.trim() ? csvToLeads(csvText, profilesByEmail) : null),
    [csvText, profilesByEmail])
  const unmatchedEmails = useMemo(() => {
    if (!preview) return []
    const bad = new Set()
    for (const l of preview.leads) {
      if (l._setterEmail && !l.setter_id) bad.add(l._setterEmail)
      if (l._closerEmail && !l.closer_id) bad.add(l._closerEmail)
    }
    return [...bad]
  }, [preview])

  async function runImport() {
    if (!preview?.leads.length) return
    setImporting(true)
    const rows = preview.leads.map(l => {
      const r = { ...l }
      delete r._setterEmail; delete r._closerEmail
      return r
    })
    const res = await upsertLeads(rows)
    setImporting(false)
    if (res?.error) { toast.error('Import failed: ' + (res.error.message || 'unknown error')); return }
    toast.success(`Imported ${rows.length} appointment${rows.length === 1 ? '' : 's'}.`)
    setImportOpen(false); setCsvText('')
    load()
  }

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
            <CalendarCheck size={18} className="text-teal" /> Leads
          </h1>
          <p className="text-[12px] text-white/40 mt-0.5">
            Appointments fed in from the field CRM, in calendar order. An appointment that RAN counts as an estimate —
            marking one <span className="text-white/55">Sold</span> records the outcome only; deal counts and revenue
            always come from the Deals page.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white transition-colors flex-shrink-0"
            style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}
            title="Backfill appointments from a CRM export">
            <Upload size={14} /> Import CSV
          </button>
        )}
      </div>

      {/* CSV backfill */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center md:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setImportOpen(false)} />
          <div className="relative w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl overflow-y-auto shadow-2xl"
            style={{ background: '#242424', border: '1px solid #333', maxHeight: '92dvh' }}>
            <div className="flex items-center justify-between px-5 py-3 sticky top-0" style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}>
              <h2 className="text-[15px] font-semibold text-white">Import appointments</h2>
              <button onClick={() => setImportOpen(false)} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[12px] text-white/45">
                Paste a CSV export from the CRM (or choose the file). Rows are matched on the appointment <b className="text-white/70">ID</b>,
                so importing the same range twice updates rather than duplicates — safe to re-run.
              </p>
              <input type="file" accept=".csv,text/csv"
                onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(setCsvText) }}
                className="block w-full text-[12px] text-white/60 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-semibold file:bg-teal file:text-dark" />
              <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={6}
                placeholder="…or paste the CSV contents here"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}
                className="w-full px-3 py-2 rounded-lg text-[12px] text-white placeholder-white/20 focus:outline-none font-mono resize-none" />

              {preview && (
                <div className="rounded-lg p-3 space-y-2 text-[12px]" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                  {preview.missing.length > 0 && (
                    <p className="text-amber-400">⚠ Missing expected column{preview.missing.length > 1 ? 's' : ''}: {preview.missing.join(', ')}</p>
                  )}
                  <p className="text-white/70">
                    <b className="text-teal">{preview.leads.length}</b> appointment{preview.leads.length === 1 ? '' : 's'} ready
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
                    {['scheduled', 'completed', 'sold', 'no_show', 'canceled'].map(s => {
                      const n = preview.leads.filter(l => l.status === s).length
                      return n ? <span key={s}>{stat(s).label}: <b className="text-white/70">{n}</b></span> : null
                    })}
                  </div>
                  {unmatchedEmails.length > 0 && (
                    <div className="text-[11px] text-amber-400/90">
                      <p>{unmatchedEmails.length} rep email{unmatchedEmails.length === 1 ? '' : 's'} not on the roster — those appointments still import, with the name as text:</p>
                      <p className="text-amber-400/60 break-words mt-0.5">{unmatchedEmails.join(', ')}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={runImport} disabled={!preview?.leads.length || importing}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-40 transition-colors">
                  {importing ? 'Importing…' : preview?.leads.length ? `Import ${preview.leads.length}` : 'Import'}
                </button>
                <button onClick={() => setImportOpen(false)}
                  className="px-5 py-2.5 rounded-xl text-[13px] text-white/50 hover:text-white transition-colors" style={{ border: '1px solid #3a3a3a' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        {/* "Sold at appt" is an APPOINTMENT OUTCOME, not a sale record — the
            deals table is the only source of deal counts and revenue. */}
        <Kpi label="Sold at Appt"     value={kpis.sold} sub="outcome, not a deal record" color="#4ade80" />
        <Kpi label="Appt Close %"     value={kpis.closeRate == null ? '—' : `${kpis.closeRate.toFixed(0)}%`} sub="sold ÷ ran" color="#a78bfa" />
        <Kpi label="No Shows"         value={kpis.noShow} color="#fb923c" />
      </div>

      {byRep.length > 0 && (
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <h3 className="text-[13px] font-semibold text-white mb-0.5">By Rep — {presetLabel(preset)}</h3>
          <p className="text-[10px] text-white/30 mb-3">
            Set → ran → sold, credited to whoever ran the appointment. <span className="text-white/45">Ran</span> is the estimate
            count feeding close rates site-wide; <span className="text-white/45">Sold</span> is the appointment's outcome, not a deal record.
          </p>
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
