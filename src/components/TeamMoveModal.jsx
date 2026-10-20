import { useEffect, useMemo, useState } from 'react'
import { X, Search, Check, CalendarClock, ArrowRight, Users, AlertTriangle, Loader2 } from 'lucide-react'
import { headIdSet, teamKeyFor, teamLabel } from '../utils/team'
import {
  azToday, addDays, monthStart, nextMonthStart, fmtDay,
  previewTeamMove, teamKeyLabel, directReportsOf,
} from '../utils/teamMove'

// ============================================================
// Move people (Admin → People). ONE flow for what used to be a drag per
// person with no date and no preview:
//
//   1. WHO — several people at once, because a reorg is never one move.
//   2. WHERE — any team head, or Unassigned.
//   3. WHEN — the EFFECTIVE DATE, which is the whole point. Deals closing on
//      or after it count for the new team; everything before stays put. The
//      old drag stamped "now", so reorganising on Monday for a change that
//      happened last Thursday sent four days of revenue to the wrong team.
//
// Then a PREVIEW that names what changes hands — including, on its own line,
// the deals sitting exactly ON the boundary day, since that is the one thing
// a date picker cannot tell you and the one thing that surprises people.
//
// THE GRANULARITY IS A DAY, NOT A SECOND, and that is the data, not a
// shortcut: deals.sale_date is a DATE fed from the ArcSite sheet's approved
// date, which has never carried a clock time. There is no afternoon to
// separate from a morning. The card says so rather than implying precision
// that does not exist.
//
// A date in the FUTURE schedules the move instead of making it (migration
// 058): the roster keeps working as-is and flips itself over on the day.
// ============================================================

const card = { background: '#1e1e1e', border: '1px solid #2a2a2a' }
const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

const Step = ({ n, label, hint, children }) => (
  <div className="flex gap-2.5">
    <span className="flex-shrink-0 w-[22px] h-[22px] rounded-md flex items-center justify-center text-[11px] font-bold mt-[1px]"
      style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', border: '1px solid rgba(0,184,148,0.3)' }}>{n}</span>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest mb-1.5">{label}</p>
      {children}
      {hint && <p className="text-[10.5px] text-white/30 mt-1.5 leading-snug">{hint}</p>}
    </div>
  </div>
)

export default function TeamMoveModal({
  users = [], deals = [], teamChanges = [], loadingDeals = false,
  initialIds = [], onSubmit, onClose,
}) {
  const heads = useMemo(() => headIdSet(users), [users])
  const active = useMemo(() => users.filter(u => u.active !== false), [users])
  const today = azToday()

  const [picked, setPicked]   = useState(() => initialIds.filter(Boolean))
  const [dest, setDest]       = useState('')          // '' = not chosen, 'unassigned' = no lead
  const [when, setWhen]       = useState(today)
  const [note, setNote]       = useState('')
  const [bringReports, setBringReports] = useState(true)
  const [q, setQ]             = useState('')
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !saving) onClose?.() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, saving])

  const teams = useMemo(
    () => active.filter(u => heads.has(u.id)).sort(byName).map(h => ({ id: h.id, label: teamLabel(h) })),
    [active, heads])

  // Anyone can be moved here, heads included — but moving a lead takes their
  // reports with them unless you say otherwise, which is the same question
  // the Edit form asks and the reason drag-and-drop refuses heads.
  const reports = useMemo(() => directReportsOf(picked, users), [picked, users])
  const movingIds = useMemo(() => {
    const ids = new Set(picked)
    if (bringReports) for (const r of reports) ids.add(r.id)
    // Moving someone INTO the team they lead is meaningless, and the database
    // rejects it, so the destination can never be among the movers.
    if (dest && dest !== 'unassigned') ids.delete(dest)
    return [...ids]
  }, [picked, reports, bringReports, dest])

  const destId = dest === 'unassigned' ? null : (dest || null)
  const destLabel = dest === '' ? '…' : teamKeyLabel(dest, users)
  const future = when > today

  const preview = useMemo(() => previewTeamMove({
    deals, users, teamChanges,
    profileIds: movingIds, newManagerId: destId, effectiveDate: when,
  }), [deals, users, teamChanges, movingIds, destId, when])

  // Someone already on the destination team is a no-op the database skips —
  // say so here rather than reporting "moved 3" when one of them never moved.
  const alreadyThere = useMemo(
    () => movingIds.filter(id => {
      const u = users.find(x => x.id === id)
      return u && teamKeyFor(u, heads) === (dest || '\0')
    }).length,
    [movingIds, users, heads, dest])
  const willMove = movingIds.length - alreadyThere

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return active
      .filter(u => !needle || (u.name || '').toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle))
      .sort(byName)
  }, [active, q])

  const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  const canSubmit = !saving && movingIds.length > 0 && dest !== '' && !!when && willMove > 0

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    const r = await onSubmit?.({ profileIds: movingIds, newManagerId: destId, effectiveDate: when, note: note.trim() })
    setSaving(false)
    if (r !== false) onClose?.()
  }

  const datePill = (label, value) => (
    <button key={label} type="button" onClick={() => setWhen(value)}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
        when === value ? 'text-teal' : 'text-white/45 hover:text-white'}`}
      style={{ background: when === value ? 'rgba(0,184,148,0.12)' : '#242424',
               border: `1px solid ${when === value ? 'rgba(0,184,148,0.4)' : '#333'}` }}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !saving && onClose?.()} />
      <div className="relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-y-auto"
        style={{ background: '#242424', border: '1px solid #333', maxHeight: '92vh' }}>

        <div className="flex items-center justify-between px-5 py-3.5 sticky top-0 z-10"
          style={{ background: '#242424', borderBottom: '1px solid #2e2e2e' }}>
          <div>
            <h2 className="text-[15px] font-semibold text-white">Move people</h2>
            <p className="text-[11px] text-white/35">Past sales stay with the old team — you choose the day it changes over.</p>
          </div>
          <button onClick={() => !saving && onClose?.()} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* ── 1. Who ── */}
          <Step n="1" label={`Who's moving${picked.length ? ` · ${picked.length} selected` : ''}`}>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {picked.map(id => {
                  const u = users.find(x => x.id === id)
                  if (!u) return null
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[11.5px] text-white/85"
                      style={{ background: '#2c2c2c', border: '1px solid #3a3a3a' }}>
                      {u.name}
                      <span className="text-white/25 text-[10px]">{teamKeyLabel(teamKeyFor(u, heads), users)}</span>
                      <button onClick={() => toggle(id)} className="p-0.5 rounded-full text-white/35 hover:text-white hover:bg-white/10">
                        <X size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="relative mb-1.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the roster…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-[12.5px] text-white placeholder-white/25 focus:outline-none focus:border-teal/40 transition-colors"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
            </div>
            <div className="rounded-lg overflow-y-auto" style={{ ...card, maxHeight: 168 }}>
              {shown.length === 0 && <p className="px-3 py-3 text-[11.5px] text-white/30 text-center">Nobody matches.</p>}
              {shown.map(u => {
                const on = picked.includes(u.id)
                return (
                  <button key={u.id} type="button" onClick={() => toggle(u.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-t border-white/5 first:border-t-0 hover:bg-white/[0.03] transition-colors">
                    <span className="w-[15px] h-[15px] rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: on ? '#00b894' : '#1a1a1a', border: `1px solid ${on ? '#00b894' : '#3a3a3a'}` }}>
                      {on && <Check size={10} className="text-dark" strokeWidth={3} />}
                    </span>
                    <span className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: '#1a1a1a', border: '1px solid #333', color: '#00b894' }}>{initialsOf(u.name)}</span>
                    <span className="text-[12.5px] text-white/85 font-medium min-w-0 truncate">{u.name}</span>
                    {heads.has(u.id) && <span className="text-[8.5px] font-bold uppercase tracking-wide text-blue-300 flex-shrink-0">lead</span>}
                    <span className="ml-auto text-[10.5px] text-white/30 flex-shrink-0 truncate max-w-[40%]">{teamKeyLabel(teamKeyFor(u, heads), users)}</span>
                  </button>
                )
              })}
            </div>
            {reports.length > 0 && (
              <label className="flex items-start gap-2 mt-2 px-2.5 py-2 rounded-lg cursor-pointer"
                style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)' }}>
                <input type="checkbox" checked={bringReports} onChange={e => setBringReports(e.target.checked)}
                  className="mt-[3px] accent-teal" />
                <span className="text-[11.5px] text-blue-200 leading-snug">
                  <Users size={11} className="inline mb-[2px] mr-1" />
                  Bring {reports.length === 1 ? 'their report' : `their ${reports.length} reports`} along
                  <span className="text-blue-200/55"> — {reports.map(r => r.name).join(', ')}</span>
                  <span className="block text-blue-200/45 mt-0.5">
                    Each gets their own dated entry, so their past deals stay with their old team too.
                  </span>
                </span>
              </label>
            )}
          </Step>

          <div className="h-px" style={{ background: '#2e2e2e' }} />

          {/* ── 2. Where ── */}
          <Step n="2" label="Moving to">
            <select value={dest} onChange={e => setDest(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[13px] text-white focus:outline-none focus:border-teal/40 transition-colors appearance-none"
              style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}>
              <option value="">Choose a team…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              <option value="unassigned">Unassigned — no team lead</option>
            </select>
          </Step>

          {/* ── 3. When ── */}
          <Step n="3" label="Effective from"
            hint={`A deal only carries a DATE — the ArcSite sheet has never had a sale time — so a move changes over at midnight, never mid-afternoon. Deals closing on or after ${fmtDay(when)} count for ${destLabel}.`}>
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={when} onChange={e => setWhen(e.target.value || today)}
                className="px-3 py-2 rounded-lg text-[13px] text-white focus:outline-none focus:border-teal/40 transition-colors"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
              {datePill('Today', today)}
              {datePill('Tomorrow', addDays(today, 1))}
              {datePill('1st of this month', monthStart(today))}
              {datePill('1st of next month', nextMonthStart(today))}
            </div>
            {future && (
              <div className="flex items-start gap-2 mt-2 px-2.5 py-2 rounded-lg"
                style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)' }}>
                <CalendarClock size={13} className="text-blue-300 flex-shrink-0 mt-[1px]" />
                <p className="text-[11.5px] text-blue-200 leading-snug">
                  This is in the future, so it gets <strong>scheduled</strong>. The roster keeps working exactly as it
                  does today and flips over on {fmtDay(when, { year: true })} by itself. You can cancel it any time before then.
                </p>
              </div>
            )}
          </Step>

          <div className="h-px" style={{ background: '#2e2e2e' }} />

          {/* ── Preview ── */}
          <div>
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest mb-1.5">What this changes</p>
            {dest === '' || !movingIds.length ? (
              <p className="px-3 py-3 rounded-lg text-[12px] text-white/30 text-center" style={card}>
                Pick who's moving and where, and this will say exactly how many deals change hands.
              </p>
            ) : future ? (
              <div className="px-3 py-3 rounded-lg" style={card}>
                <p className="text-[12px] text-white/55 leading-snug">
                  Nothing changes hands yet. On {fmtDay(when, { year: true })} these {willMove === 1 ? 'person' : `${willMove} people`} move
                  to <strong className="text-white">{destLabel}</strong>, and only deals closing from that day
                  forward count for it. Deals closing between now and then stay with their current team permanently.
                </p>
              </div>
            ) : loadingDeals ? (
              <p className="px-3 py-3 rounded-lg text-[12px] text-white/30 text-center flex items-center justify-center gap-2" style={card}>
                <Loader2 size={13} className="animate-spin" /> Checking the deals…
              </p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={card}>
                <Row label={`Deals moving to ${destLabel}`}
                  value={`${preview.movingCount} · ${money(preview.movingRevenue)}`} tone="move" />
                <Row label="Deals staying where they are"
                  value={`${preview.stayingCount} · ${money(preview.stayingRevenue)}`} tone="stay" />
                <Row label={`Closing on ${fmtDay(when)} itself`}
                  value={preview.boundaryCount
                    ? `${preview.boundaryCount} · ${money(preview.boundaryRevenue)} → ${destLabel}`
                    : 'none'}
                  tone={preview.boundaryCount ? 'move' : 'stay'} />
                {preview.boundaryCount > 0 && (
                  <div className="px-3 py-2 border-t border-white/5" style={{ background: 'rgba(245,158,11,0.05)' }}>
                    <p className="text-[10.5px] text-amber-300/80 leading-snug mb-1">
                      <AlertTriangle size={10} className="inline mb-[2px] mr-1" />
                      On the boundary — these go to {destLabel}. Push the date to {fmtDay(addDays(when, 1))} and they stay put.
                    </p>
                    {preview.boundary.slice(0, 4).map(d => (
                      <p key={d.id} className="text-[11px] text-white/50 truncate">
                        {d.name} <span className="text-white/25">· {money(d.revenue)}</span>
                      </p>
                    ))}
                    {preview.boundary.length > 4 && (
                      <p className="text-[10.5px] text-white/25">+{preview.boundary.length - 4} more</p>
                    )}
                  </div>
                )}
                {preview.perPerson.length > 1 && preview.movingCount > 0 && (
                  <div className="px-3 py-2 border-t border-white/5">
                    {preview.perPerson.filter(p => p.movingCount || p.stayingCount).map(p => (
                      <p key={p.id} className="text-[11px] text-white/45 flex items-center gap-1.5">
                        <span className="text-white/70">{p.name}</span>
                        <ArrowRight size={9} className="text-white/20" />
                        {p.movingCount} moving<span className="text-white/20">·</span>{p.stayingCount} staying
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Why (optional) ── */}
          <div>
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest mb-1.5">Why (optional)</p>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={120}
              placeholder="e.g. Q4 reorg — Jared's team split"
              className="w-full px-3 py-2 rounded-lg text-[12.5px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors"
              style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
            <p className="text-[10.5px] text-white/25 mt-1">Shows on the change log beside the dates.</p>
          </div>

          {alreadyThere > 0 && (
            <p className="text-[11.5px] text-amber-300/80">
              {alreadyThere} of the {movingIds.length} selected {alreadyThere === 1 ? 'is' : 'are'} already
              on {destLabel} — {alreadyThere === 1 ? 'they' : 'they'} will be left alone rather than given a
              no-op entry in the log.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 sticky bottom-0"
          style={{ background: '#242424', borderTop: '1px solid #2e2e2e' }}>
          <button onClick={() => !saving && onClose?.()}
            className="px-3.5 py-2 rounded-xl text-[12.5px] font-semibold text-white/50 hover:text-white transition-colors"
            style={{ background: '#2c2c2c', border: '1px solid #3a3a3a' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canSubmit}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-bold text-dark bg-teal disabled:opacity-35 disabled:cursor-not-allowed transition-opacity">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {future
              ? `Schedule ${willMove > 0 ? willMove : ''} for ${fmtDay(when)}`.replace('  ', ' ')
              : `Move ${willMove > 0 ? willMove : ''} ${willMove === 1 ? 'person' : 'people'}`.replace('  ', ' ')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-white/5 first:border-t-0">
      <span className="text-[12px] text-white/55 min-w-0">{label}</span>
      <span className={`text-[12.5px] font-bold tabular-nums flex-shrink-0 ${tone === 'move' ? 'text-teal' : 'text-white/35'}`}>{value}</span>
    </div>
  )
}
