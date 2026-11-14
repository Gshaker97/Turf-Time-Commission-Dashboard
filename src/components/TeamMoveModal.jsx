import { useEffect, useMemo, useState } from 'react'
import { X, Search, Check, CalendarClock, ArrowRight, Flag, AlertTriangle, Loader2 } from 'lucide-react'
import { SURFACE, GOLD_WASH, Pill, PrimaryButton, SecondaryButton, IconButton, Input, Select, inputCls } from '../components/ui'
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

const card = SURFACE.raise
const WARN = 'var(--warn)'
const WARN_BOX = { background: 'rgba(210,160,116,0.10)', border: '1px solid rgba(210,160,116,0.4)' }
const NOTE_BOX = SURFACE.well
const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

const Step = ({ n, label, hint, children }) => (
  <div className="flex gap-2.5">
    <span className="flex-shrink-0 w-[22px] h-[22px] rounded-md flex items-center justify-center text-[13px] font-bold mt-[1px] text-bank-gold-tx"
      style={GOLD_WASH}>{n}</span>
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-bold text-bank-fa uppercase tracking-wide mb-1.5">{label}</p>
      {children}
      {hint && <p className="text-[13px] text-bank-mu mt-1.5 leading-snug">{hint}</p>}
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
    <Pill key={label} type="button" active={when === value} onClick={() => setWhen(value)} className="border-bank-line">{label}</Pill>
  )
  const sel = `${inputCls} appearance-none`

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => !saving && onClose?.()} />
      <div className="relative w-full md:max-w-2xl h-[100dvh] md:h-auto md:max-h-[92vh] rounded-none md:rounded-2xl overflow-y-auto flex flex-col"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }}
        role="dialog" aria-modal="true" aria-label="Move people">

        <div className="flex items-center justify-between gap-3 px-5 py-3 sticky top-0 z-10"
          style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-bank-tx">Move people</h2>
            <p className="text-[13px] text-bank-mu">Past sales stay with the old team — you choose the day it changes over.</p>
          </div>
          <IconButton onClick={() => !saving && onClose?.()} aria-label="Close"><X size={16} /></IconButton>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          {/* ── 1. Who ── */}
          <Step n="1" label={`Who's moving${picked.length ? ` · ${picked.length} selected` : ''}`}>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {picked.map(id => {
                  const u = users.find(x => x.id === id)
                  if (!u) return null
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[13px] text-bank-tx" style={SURFACE.raise}>
                      {u.name}
                      <span className="text-bank-fa text-[12px]">{teamKeyLabel(teamKeyFor(u, heads), users)}</span>
                      <button onClick={() => toggle(id)} aria-label={`Remove ${u.name}`} className="p-1 rounded-full text-bank-mu hover:text-bank-tx hover:bg-bank-card min-w-[28px] min-h-[28px] flex items-center justify-center">
                        <X size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="relative mb-1.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the roster…" aria-label="Search the roster" className="pl-8" style={SURFACE.well} />
            </div>
            <div className="rounded-lg overflow-y-auto" style={{ ...card, maxHeight: 200 }}>
              {shown.length === 0 && <p className="px-3 py-3 text-[13px] text-bank-mu text-center">Nobody matches.</p>}
              {shown.map(u => {
                const on = picked.includes(u.id)
                return (
                  <button key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={on}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] text-left border-t border-bank-line first:border-t-0 hover:bg-bank-card transition-colors">
                    <span className="w-[16px] h-[16px] rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: on ? 'var(--gold)' : 'var(--bg)', border: `1px solid ${on ? 'var(--gold)' : 'var(--line)'}` }}>
                      {on && <Check size={11} strokeWidth={3} style={{ color: 'var(--gold-ink)' }} />}
                    </span>
                    <span className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 text-bank-mu"
                      style={SURFACE.well}>{initialsOf(u.name)}</span>
                    <span className="text-[13px] text-bank-tx font-medium min-w-0 truncate">{u.name}</span>
                    {heads.has(u.id) && <span className="text-[12px] font-bold uppercase tracking-wide text-bank-mu flex-shrink-0">lead</span>}
                    <span className="ml-auto text-[13px] text-bank-fa flex-shrink-0 truncate max-w-[40%]">{teamKeyLabel(teamKeyFor(u, heads), users)}</span>
                  </button>
                )
              })}
            </div>
            {/* Picking a LEAD dissolves their team. State it, then ask the
                one thing that is genuinely open: where their reps go. */}
            {pickedHeads.length > 0 && (
              <div className="mt-2 px-3 py-2.5 rounded-xl" style={WARN_BOX}>
                <p className="text-[13px] font-bold flex items-start gap-1.5" style={{ color: WARN }}>
                  <Flag size={12} className="mt-[2px] flex-shrink-0" />
                  <span>
                    {pickedHeads.map(h => h.name).join(' and ')} lead{pickedHeads.length === 1 ? 's' : ''}{' '}
                    {pickedHeads.map(h => teamLabel(h)).join(' and ')}
                  </span>
                </p>
                <p className="text-[13px] mt-1 leading-snug text-bank-mu">
                  Moving {pickedHeads.length === 1 ? 'a lead' : 'leads'} here makes {pickedHeads.length === 1 ? 'them a rep' : 'them reps'} on{' '}
                  <strong className="text-bank-tx">{destPhrase}</strong>, so{' '}
                  {pickedHeads.length === 1 ? 'that team is' : 'those teams are'} dissolved. Past sales keep the
                  name in every report. To just change who {pickedHeads.length === 1 ? 'they report' : 'they report'} to,
                  use Edit instead.
                </p>
                {reports.length > 0 && (
                  <div className="mt-2.5 pl-3" style={{ borderLeft: '1.5px solid rgba(210,160,116,0.4)' }}>
                    <p className="text-[13px] font-bold uppercase tracking-wide mb-1.5" style={{ color: WARN }}>
                      {reports.length === 1 ? 'Its rep goes to' : `Its ${reports.length} reps go to`}
                    </p>
                    <select value={repsDest} onChange={e => setRepsDest(e.target.value)} aria-label="Where the reps go"
                      className={sel} style={SURFACE.well}>
                      <option value="same">{dest ? `${destLabel} — same as their lead` : 'The same team as their lead'}</option>
                      {teams.filter(t => t.id !== dest).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      <option value="unassigned">Unassigned — no team lead</option>
                    </select>
                    <p className="text-[13px] text-bank-mu mt-1 leading-snug">
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
              <div className="mt-2 px-3 py-2.5 rounded-xl" style={NOTE_BOX}>
                <p className="text-[13px] font-bold uppercase tracking-wide mb-1.5 text-bank-mu">
                  {reports.length === 1 ? 'Their report goes to' : `Their ${reports.length} reports go to`}
                </p>
                <select value={repsDest} onChange={e => setRepsDest(e.target.value)} aria-label="Where their reports go"
                  className={sel} style={SURFACE.raise}>
                  <option value="same">{dest ? `${destLabel} — same as their lead` : 'The same team as whoever is moving'}</option>
                  {teams.filter(t => t.id !== dest).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value="unassigned">Unassigned — no team lead</option>
                </select>
                <p className="text-[13px] mt-1 leading-snug text-bank-fa">
                  {reports.map(r => r.name).join(', ')}
                </p>
              </div>
            )}
          </Step>

          <div className="h-px" style={{ background: 'var(--line)' }} />

          {/* ── 2. Where ── */}
          <Step n="2" label="Moving to">
            <Select value={dest} onChange={e => setDest(e.target.value)} aria-label="Moving to" className="appearance-none" style={SURFACE.well}>
              <option value="">Choose a team…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              <option value="unassigned">Unassigned — no team lead</option>
            </Select>
          </Step>

          {/* ── 3. When ── */}
          <Step n="3" label="Effective from"
            hint={`A deal only carries a DATE — the ArcSite sheet has never had a sale time — so a move changes over at midnight, never mid-afternoon. Deals closing on or after ${fmtDay(when)} count for ${destLabel}.`}>
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="date" value={when} onChange={e => setWhen(e.target.value || today)} aria-label="Effective date" className="!w-auto" style={SURFACE.well} />
              {datePill('Today', today)}
              {datePill('Tomorrow', addDays(today, 1))}
              {datePill('1st of this month', monthStart(today))}
              {datePill('1st of next month', nextMonthStart(today))}
            </div>
            {future && (
              <div className="flex items-start gap-2 mt-2 px-2.5 py-2 rounded-lg" style={NOTE_BOX}>
                <CalendarClock size={13} className="text-bank-mu flex-shrink-0 mt-[1px]" />
                <p className="text-[13px] text-bank-mu leading-snug">
                  This is in the future, so it gets <strong className="text-bank-tx">scheduled</strong>. The roster keeps working exactly as it
                  does today and flips over on {fmtDay(when, { year: true })} by itself. You can cancel it any time before then.
                </p>
              </div>
            )}
          </Step>

          <div className="h-px" style={{ background: 'var(--line)' }} />

          {/* ── Preview ── */}
          <div>
            <p className="text-[13px] font-bold text-bank-fa uppercase tracking-wide mb-1.5">What this changes</p>
            {dest === '' || !movingIds.length ? (
              <p className="px-3 py-3 rounded-lg text-[13px] text-bank-mu text-center" style={card}>
                Pick who's moving and where, and this will say exactly how many deals change hands.
              </p>
            ) : future ? (
              <div className="px-3 py-3 rounded-lg" style={card}>
                <p className="text-[13px] text-bank-mu leading-snug">
                  Nothing changes hands yet. On {fmtDay(when, { year: true })} these {willMove === 1 ? 'person' : `${willMove} people`} move
                  to <strong className="text-bank-tx">{destLabel}</strong>, and only deals closing from that day
                  forward count for it. Deals closing between now and then stay with their current team permanently.
                  {pickedHeads.length > 0 && (
                    <> {pickedHeads.map(h => teamLabel(h)).join(' and ')} {pickedHeads.length === 1 ? 'is' : 'are'} dissolved
                      that same day, not today — the chart keeps working as it does now until then.</>
                  )}
                </p>
              </div>
            ) : loadingDeals ? (
              <p className="px-3 py-3 rounded-lg text-[13px] text-bank-mu text-center flex items-center justify-center gap-2" style={card} role="status">
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
                  <div className="px-3 py-2 border-t border-bank-line" style={{ background: 'rgba(210,160,116,0.06)' }}>
                    <p className="text-[13px] leading-snug mb-1" style={{ color: WARN }}>
                      <AlertTriangle size={10} className="inline mb-[2px] mr-1" />
                      On the boundary — these go to {destLabel}. Push the date to {fmtDay(addDays(when, 1))} and they stay put.
                    </p>
                    {preview.boundary.slice(0, 4).map(d => (
                      <p key={d.id} className="text-[13px] text-bank-mu truncate">
                        {d.name} <span className="text-bank-fa">· {money(d.revenue)}</span>
                      </p>
                    ))}
                    {preview.boundary.length > 4 && (
                      <p className="text-[13px] text-bank-fa">+{preview.boundary.length - 4} more</p>
                    )}
                  </div>
                )}
                {preview.perPerson.length > 1 && preview.movingCount > 0 && (
                  <div className="px-3 py-2 border-t border-bank-line">
                    {preview.perPerson.filter(p => p.movingCount || p.stayingCount).map(p => (
                      <p key={p.id} className="text-[13px] text-bank-mu flex items-center gap-1.5">
                        <span className="text-bank-tx">{p.name}</span>
                        <ArrowRight size={9} className="text-bank-fa" />
                        {p.movingCount} moving<span className="text-bank-fa">·</span>{p.stayingCount} staying
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Why (optional) ── */}
          <div>
            <p className="text-[13px] font-bold text-bank-fa uppercase tracking-wide mb-1.5">Why (optional)</p>
            <Input value={note} onChange={e => setNote(e.target.value)} maxLength={120} aria-label="Why"
              placeholder="e.g. Q4 reorg — Jared's team split" style={SURFACE.well} />
            <p className="text-[13px] text-bank-fa mt-1">Shows on the change log beside the dates.</p>
          </div>

          {/* Only worth saying when SOME of them still move; when none do,
              `blocked` below says it properly and offers the way out. */}
          {alreadyThere > 0 && willMove > 0 && (
            <p className="text-[13px]" style={{ color: WARN }}>
              {alreadyThere} of the {movingIds.length} selected {alreadyThere === 1 ? 'is' : 'are'} already
              on {destLabel} — they will be left alone rather than given a no-op entry in the log.
            </p>
          )}
        </div>

        {/* Why the button is off. Sits directly above it, where the eye
            goes after finding the control greyed out. */}
        {blocked && (
          <div className="px-5 pb-1 pt-0 sticky bottom-[68px] md:bottom-[57px]" style={{ background: 'var(--card)' }}>
            <div className="px-3 py-2 rounded-lg" style={blocked.tone === 'amber' ? WARN_BOX : SURFACE.raise}>
              <p className="text-[13px]" style={{ color: blocked.tone === 'amber' ? WARN : 'var(--mu)' }}>
                {blocked.text}
              </p>
              {blocked.hint && (
                <p className="text-[13px] mt-1 leading-snug text-bank-mu">
                  {blocked.hint}
                </p>
              )}
              {blocked.action && (
                <SecondaryButton onClick={() => { onClose?.(); onOpenLog?.() }} className="mt-1.5">
                  {blocked.action}
                </SecondaryButton>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-3 sticky bottom-0"
          style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <SecondaryButton onClick={() => !saving && onClose?.()} className="px-3.5 min-h-[44px]">Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={!canSubmit} className="ml-auto px-4 py-2">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {future
              ? `Schedule ${willMove > 0 ? willMove : ''} for ${fmtDay(when)}`.replace('  ', ' ')
              : `Move ${willMove > 0 ? willMove : ''} ${willMove === 1 ? 'person' : 'people'}`.replace('  ', ' ')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-bank-line first:border-t-0">
      <span className="text-[13px] text-bank-mu min-w-0">{label}</span>
      <span className={`text-[13px] font-bold tabular-nums flex-shrink-0 ${tone === 'move' ? 'text-bank-tx' : 'text-bank-fa'}`}>{value}</span>
    </div>
  )
}
