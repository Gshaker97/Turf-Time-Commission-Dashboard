import { useEffect, useMemo, useState } from 'react'
import { X, Search, Check, CalendarClock, ArrowRight, Flag, AlertTriangle, Loader2 } from 'lucide-react'
import { headIdSet, teamKeyFor, teamLabel } from '../utils/team'
import {
  azToday, addDays, monthStart, nextMonthStart, fmtDay,
  previewTeamMoveGroups, teamKeyLabel, directReportsOf,
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
// PICKING A TEAM LEAD DISSOLVES THEIR TEAM (059). Headship is a ROLE, so
// moving a lead without demoting them changed their reports-to and left them
// heading their own column — the move landed in the data and vanished from
// the chart. There is deliberately NO "keep them leading it, just under a new
// director" option (per Keaton): that is a plain reports-to edit and the Edit
// form already does it. So the modal states the consequence and asks the one
// question that remains — where the team's reps go.
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
  initialIds = [], onSubmit, onClose, onOpenLog,
}) {
  const heads = useMemo(() => headIdSet(users), [users])
  const active = useMemo(() => users.filter(u => u.active !== false), [users])
  const today = azToday()

  const [picked, setPicked]   = useState(() => initialIds.filter(Boolean))
  const [dest, setDest]       = useState('')          // '' = not chosen, 'unassigned' = no lead
  const [when, setWhen]       = useState(today)
  const [note, setNote]       = useState('')
  // Where the reps of a dissolved team go. 'same' = wherever their lead is
  // heading, which is the common answer; otherwise a team key.
  const [repsDest, setRepsDest] = useState('same')
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

  // Moving someone INTO the team they lead is meaningless and the database
  // rejects it, so the destination is never among the movers.
  const pickedIds = useMemo(
    () => picked.filter(id => !(dest && dest !== 'unassigned' && id === dest)),
    [picked, dest])
  // Leads among the selection: these get demoted, and their teams dissolve.
  const pickedHeads = useMemo(() => pickedIds.filter(id => heads.has(id)).map(id => users.find(u => u.id === id)).filter(Boolean), [pickedIds, heads, users])
  const pickedPlain = useMemo(() => pickedIds.filter(id => !heads.has(id)), [pickedIds, heads])
  // Everyone reporting to someone in the selection — the people whose team is
  // about to disappear from under them.
  const reports = useMemo(() => directReportsOf(pickedIds, users), [pickedIds, users])

  const destId = dest === 'unassigned' ? null : (dest || null)
  const destLabel = dest === '' ? '…' : teamKeyLabel(dest, users)
  // The lead panel sits ABOVE "Moving to", so it has to read correctly before
  // a destination exists. A bare ellipsis mid-sentence ("makes them a rep on
  // …") reads like a rendering fault.
  const destPhrase = dest === '' ? 'the team you pick below' : teamKeyLabel(dest, users)
  const repsDestKey = repsDest === 'same' ? dest : repsDest
  const repsDestId  = repsDestKey === 'unassigned' ? null : (repsDestKey || null)
  const repsDestLabel = dest === '' && repsDest === 'same' ? '…' : teamKeyLabel(repsDestKey, users)
  const future = when > today

  // The groups the save will perform, and the shape the preview reads. Leads
  // and their reps can land on DIFFERENT teams, so one destination could not
  // describe this.
  const groups = useMemo(() => [
    { profileIds: pickedHeads.map(h => h.id), newManagerId: destId, demote: true },
    { profileIds: pickedPlain,                newManagerId: destId, demote: false },
    { profileIds: reports.map(r => r.id),     newManagerId: repsDestId, demote: false },
  ].filter(g => g.profileIds.length), [pickedHeads, pickedPlain, reports, destId, repsDestId])

  const movingIds = useMemo(() => groups.flatMap(g => g.profileIds), [groups])

  const preview = useMemo(() => previewTeamMoveGroups({
    deals, users, teamChanges, groups, effectiveDate: when,
  }), [deals, users, teamChanges, groups, when])

  // Someone already on their group's destination is a no-op the database
  // skips — say so here rather than reporting "moved 3" when one never moved.
  // Tested exactly as the database tests it (reports-to, not team key): for a
  // LEAD those differ, and a lead already under the destination is still not
  // a no-op while they have a role to lose.
  const alreadyThere = useMemo(() => {
    let n = 0
    for (const g of groups) {
      for (const id of g.profileIds) {
        const u = users.find(x => x.id === id)
        if (!u) continue
        const onIt = (u.manager_id ?? null) === (g.newManagerId ?? null)
        if (onIt && !(g.demote && u.role !== 'rep')) n++
      }
    }
    return n
  }, [groups, users])
  const willMove = movingIds.length - alreadyThere

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return active
      .filter(u => !needle || (u.name || '').toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle))
      .sort(byName)
  }, [active, q])

  const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  const canSubmit = !saving && movingIds.length > 0 && dest !== '' && !!when && willMove > 0

  // WHY the button is disabled. A greyed-out control that explains nothing is
  // a dead end — the "already on that team" case especially, because the
  // thing you actually want then is to re-date the move that already
  // happened, which lives in the change log and not in this modal at all.
  const blocked = (() => {
    if (saving || canSubmit) return null
    if (!movingIds.length) return { text: 'Pick who’s moving.' }
    if (dest === '')       return { text: 'Choose a team to move them to.' }
    if (!when)             return { text: 'Pick the day it takes effect.' }
    if (willMove === 0) return {
      tone: 'amber',
      text: movingIds.length === 1
        ? `They are already on ${destLabel}, so there is nothing to move.`
        : `All ${movingIds.length} are already on ${destLabel}, so there is nothing to move.`,
      hint: 'To change WHEN that move counted from, edit it in the Team change log instead.',
      action: onOpenLog ? 'Open the change log' : null,
    }
    return null
  })()

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    // The modal decides WHAT happens (who, where, demote or not); the page
    // performs it. Each group is one move_team_members call.
    const r = await onSubmit?.({ groups, effectiveDate: when, note: note.trim(), destId })
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
            {/* Picking a LEAD dissolves their team. State it, then ask the
                one thing that is genuinely open: where their reps go. */}
            {pickedHeads.length > 0 && (
              <div className="mt-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <p className="text-[12.5px] font-bold text-amber-300 flex items-start gap-1.5">
                  <Flag size={12} className="mt-[2px] flex-shrink-0" />
                  <span>
                    {pickedHeads.map(h => h.name).join(' and ')} lead{pickedHeads.length === 1 ? 's' : ''}{' '}
                    {pickedHeads.map(h => teamLabel(h)).join(' and ')}
                  </span>
                </p>
                <p className="text-[11.5px] mt-1 leading-snug" style={{ color: 'rgba(245,197,114,0.72)' }}>
                  Moving {pickedHeads.length === 1 ? 'a lead' : 'leads'} here makes {pickedHeads.length === 1 ? 'them a rep' : 'them reps'} on{' '}
                  <strong className="text-amber-200">{destPhrase}</strong>, so{' '}
                  {pickedHeads.length === 1 ? 'that team is' : 'those teams are'} dissolved. Past sales keep the
                  name in every report. To just change who {pickedHeads.length === 1 ? 'they report' : 'they report'} to,
                  use Edit instead.
                </p>
                {reports.length > 0 && (
                  <div className="mt-2.5 pl-3" style={{ borderLeft: '1.5px solid rgba(245,158,11,0.3)' }}>
                    <p className="text-[10px] font-bold text-amber-300/70 uppercase tracking-widest mb-1.5">
                      {reports.length === 1 ? 'Its rep goes to' : `Its ${reports.length} reps go to`}
                    </p>
                    <select value={repsDest} onChange={e => setRepsDest(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[12.5px] text-white focus:outline-none focus:border-teal/40 transition-colors appearance-none"
                      style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}>
                      <option value="same">{dest ? `${destLabel} — same as their lead` : 'The same team as their lead'}</option>
                      {teams.filter(t => t.id !== dest).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      <option value="unassigned">Unassigned — no team lead</option>
                    </select>
                    <p className="text-[10.5px] text-amber-200/45 mt-1 leading-snug">
                      {reports.map(r => r.name).join(', ')} — each gets their own dated entry, so their past
                      deals stay with their old team too.
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* A non-lead with people pointing at them: a stale reports-to
                link, which is not a team. They still have to land somewhere. */}
            {pickedHeads.length === 0 && reports.length > 0 && (
              <div className="mt-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(147,197,253,0.7)' }}>
                  {reports.length === 1 ? 'Their report goes to' : `Their ${reports.length} reports go to`}
                </p>
                <select value={repsDest} onChange={e => setRepsDest(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-[12.5px] text-white focus:outline-none focus:border-teal/40 transition-colors appearance-none"
                  style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}>
                  <option value="same">{dest ? `${destLabel} — same as their lead` : 'The same team as whoever is moving'}</option>
                  {teams.filter(t => t.id !== dest).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value="unassigned">Unassigned — no team lead</option>
                </select>
                <p className="text-[10.5px] mt-1 leading-snug" style={{ color: 'rgba(147,197,253,0.5)' }}>
                  {reports.map(r => r.name).join(', ')}
                </p>
              </div>
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
                  {pickedHeads.length > 0 && (
                    <> {pickedHeads.map(h => teamLabel(h)).join(' and ')} {pickedHeads.length === 1 ? 'is' : 'are'} dissolved
                      that same day, not today — the chart keeps working as it does now until then.</>
                  )}
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
                {pickedHeads.length > 0 && (
                  <Row label={pickedHeads.length === 1
                    ? `${pickedHeads[0].name} stops leading a team`
                    : `${pickedHeads.length} leads stop leading a team`}
                    value={reports.length
                      ? `${reports.length} rep${reports.length === 1 ? '' : 's'} → ${repsDestLabel}`
                      : 'no reps to reassign'}
                    tone="move" />
                )}
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

          {/* Only worth saying when SOME of them still move; when none do,
              `blocked` below says it properly and offers the way out. */}
          {alreadyThere > 0 && willMove > 0 && (
            <p className="text-[11.5px] text-amber-300/80">
              {alreadyThere} of the {movingIds.length} selected {alreadyThere === 1 ? 'is' : 'are'} already
              on {destLabel} — they will be left alone rather than given a no-op entry in the log.
            </p>
          )}
        </div>

        {/* Why the button is off. Sits directly above it, where the eye
            goes after finding the control greyed out. */}
        {blocked && (
          <div className="px-5 pb-1 pt-0 sticky bottom-[57px]" style={{ background: '#242424' }}>
            <div className="px-3 py-2 rounded-lg" style={blocked.tone === 'amber'
              ? { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }
              : { background: '#1e1e1e', border: '1px solid #2e2e2e' }}>
              <p className={`text-[11.5px] ${blocked.tone === 'amber' ? 'text-amber-200' : 'text-white/45'}`}>
                {blocked.text}
              </p>
              {blocked.hint && (
                <p className="text-[11px] mt-1 leading-snug" style={{ color: 'rgba(245,197,114,0.72)' }}>
                  {blocked.hint}
                </p>
              )}
              {blocked.action && (
                <button onClick={() => { onClose?.(); onOpenLog?.() }}
                  className="mt-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-dark bg-amber-400">
                  {blocked.action}
                </button>
              )}
            </div>
          </div>
        )}

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
