import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, KeyRound, UserPlus, Pencil, Trash2, UserCheck, UserMinus, ShieldCheck,
  ChevronDown, GripVertical, MoreHorizontal, CalendarClock, ArrowRightLeft,
} from 'lucide-react'
import { changeDay, headIdSet, teamLabel } from '../utils/team'
import { fmtDay } from '../utils/teamMove'
import { SURFACE, GOLD_WASH, Input, PrimaryButton, SecondaryButton, IconButton } from '../components/ui'

// ============================================================
// The roster as an org chart (Admin → People). Per Keaton, replacing the
// flat Users list:
//   • Leadership across the top (admin / VP / director).
//   • One column per team lead, their reps stacked beneath. Managers ALWAYS
//     get a column, even empty — a team with nobody on it should be visible,
//     not missing. Sorted by name so the layout never reshuffles.
//   • Unassigned is a real column too — dashed, amber — and a valid drag
//     source, so fixing a stray rep is one drag.
//   • Drag a rep onto another column to move them. The page owns the confirm
//     and the write (onMove) so the same patchUser → updateUser path is used
//     and the team_changes trigger stamps the date. Heads are never
//     draggable: moving a whole team triggers the reports cascade, which
//     deserves the Edit form, not a drop.
//   • Deactivated people live ONLY in a drawer at the bottom, collapsed by
//     default, each with a Reactivate button. They're never faded in place.
//   • A row's actions are key · edit · DEACTIVATE · delete. Deactivate is how
//     someone leaves; Delete is only for a row added by mistake, since a real
//     person's deals still reference them.
//   • Phones: columns stack and each becomes collapsible; row actions fold
//     into a ⋯ menu that also offers "Move to…" since touch has no drag.
// Presentational + drag state only — every write goes back up as a handler.
// ============================================================

const COLLAPSE_KEY = 'tt_people_collapsed'
const DRAWER_KEY   = 'tt_people_deactivated_open'
const card = SURFACE.card
// Role tags read by their text; leadership in ivory, everyone else muted.
const ROLE_COLOR = { admin: 'text-bank-tx', vp: 'text-bank-tx', director: 'text-bank-tx', manager: 'text-bank-mu', rep: 'text-bank-fa' }
const WARN = 'var(--warn)', NEG = 'var(--neg)'
const badge = (color) => ({ color, border: `1px solid ${color}66` })
const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

export default function PeopleChart({
  users = [], teamChanges = [], pendingMoves = [], hasUserAdmin = false, busyUser = '',
  onAdd, onEdit, onDelete, onToggleActive, onResetLogin, onCreateLogin, onMove, onMovePeople,
  onRenameTeam,
}) {
  // Inline rename of a team's official name (the column banner). Enter/blur
  // commit, Escape cancels, empty reverts to the default "<Head>'s Team".
  // The ref guards the Enter→blur double-fire so one edit is one write.
  const [renaming, setRenaming] = useState(null)   // head id being renamed
  const [draft, setDraft] = useState('')
  const committing = useRef(false)
  const startRename = (head) => { setRenaming(head.id); setDraft(head.team_name || '') }
  const commitRename = (head) => {
    if (renaming !== head.id || committing.current) return
    committing.current = true
    setRenaming(null)
    const next = draft.trim()
    if ((head.team_name || '') !== next) onRenameTeam?.(head, next || null)
    setTimeout(() => { committing.current = false }, 0)
  }
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const match = (u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)

  // ── Grouping (same head rule as everywhere else: utils/team.js) ──
  const active   = useMemo(() => users.filter(u => u.active !== false), [users])
  const inactive = useMemo(() => users.filter(u => u.active === false).sort(byName), [users])
  const heads    = useMemo(() => headIdSet(users), [users])
  const { leadership, teams, unassigned } = useMemo(() => {
    const reportsTo = {}
    active.forEach(u => { if (u.manager_id) (reportsTo[u.manager_id] ||= []).push(u) })
    const teams = active.filter(u => heads.has(u.id)).sort(byName).map(h => ({
      head: h,
      members: (reportsTo[h.id] || []).filter(u => !heads.has(u.id)).sort(byName),
    }))
    const grouped = new Set(teams.flatMap(t => [t.head.id, ...t.members.map(m => m.id)]))
    const rest = active.filter(u => !grouped.has(u.id))
    // Leadership = every admin / VP / director (a director who heads a column
    // shows here too — the approved design), plus any non-rep who fell
    // outside every team.
    const RANK = { admin: 0, vp: 1, director: 2, manager: 3, rep: 4 }
    const lead = new Map()
    active.filter(u => ['admin', 'vp', 'director'].includes(u.role)).forEach(u => lead.set(u.id, u))
    rest.filter(u => u.role !== 'rep').forEach(u => lead.set(u.id, u))
    const leadership = [...lead.values()].sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9) || byName(a, b))
    const unassigned = rest.filter(u => u.role === 'rep').sort(byName)
    return { leadership, teams, unassigned }
  }, [active, heads])

  // Latest logged move per person → "since <date>" on their card. Keyed on
  // the move's EFFECTIVE day (058), and compared — not just "the first row
  // the fetch handed us", which is ordered by changed_at and so picks the
  // wrong one as soon as a move has been backdated or scheduled.
  const sinceByProfile = useMemo(() => {
    const m = {}
    for (const c of teamChanges) {
      const day = changeDay(c)
      if (!m[c.profile_id] || day > m[c.profile_id]) m[c.profile_id] = day
    }
    return m
  }, [teamChanges])
  // Upcoming moves, so the chart shows BOTH states: where someone is now,
  // and where they are going. Without this a scheduled reorg is invisible
  // until the day it lands, which is exactly when it should be no surprise.
  const upcomingByProfile = useMemo(() => {
    const m = {}
    for (const p of pendingMoves) {
      if (p.applied_at || p.canceled_at) continue
      if (!m[p.profile_id] || p.effective_date < m[p.profile_id].effective_date) m[p.profile_id] = p
    }
    return m
  }, [pendingMoves])
  const nameOf = (id) => users.find(u => u.id === id)?.name

  // ── Collapse state (per browser). Phones open with only the first team
  // expanded so a 23-person roster isn't a 23-card scroll. ──
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY)
      if (saved) return new Set(JSON.parse(saved))
    } catch { /* ignore */ }
    return null   // decided once teams are known
  })
  useEffect(() => {
    if (collapsed !== null || !teams.length) return
    const phone = typeof window !== 'undefined' && window.innerWidth < 768
    setCollapsed(new Set(phone ? [...teams.slice(1).map(t => t.head.id), 'unassigned'] : []))
  }, [collapsed, teams])
  const isCollapsed = (key) => collapsed?.has(key) ?? false
  const toggleCol = (key) => setCollapsed(prev => {
    const next = new Set(prev ?? [])
    next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try { return localStorage.getItem(DRAWER_KEY) === 'on' } catch { return false }
  })
  const toggleDrawer = () => setDrawerOpen(v => {
    try { localStorage.setItem(DRAWER_KEY, v ? 'off' : 'on') } catch { /* ignore */ }
    return !v
  })

  // ── Drag & drop (desktop). `dragging` = user id; `over` = column key. ──
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const [menuFor, setMenuFor] = useState(null)   // ⋯ menu open on this user id (phones)
  const draggable = (u) => !heads.has(u.id) && u.active !== false
  const dragUser = dragging ? users.find(u => u.id === dragging) : null
  const colKeyOf = (u) => (u.manager_id && heads.has(u.manager_id)) ? u.manager_id : 'unassigned'
  const dropOn = (colKey) => {
    const u = dragUser
    setDragging(null); setOver(null)
    if (!u) return
    if (colKeyOf(u) === colKey) return
    onMove?.(u, colKey === 'unassigned' ? null : colKey)
  }
  const dragProps = (u) => draggable(u) ? {
    draggable: true,
    onDragStart: (e) => { setDragging(u.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', u.id) } catch { /* ignore */ } },
    onDragEnd: () => { setDragging(null); setOver(null) },
  } : {}
  const dropProps = (colKey) => ({
    onDragOver: (e) => { if (!dragUser) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== colKey) setOver(colKey) },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === colKey ? null : o)) },
    onDrop: (e) => { e.preventDefault(); dropOn(colKey) },
  })
  // Targets for the phone "Move to…" menu: every team head + Unassigned.
  const moveTargets = teams.map(t => ({ value: t.head.id, label: teamLabel(t.head) }))

  // ── One person card ──
  function Person({ u, inTeam = true }) {
    const isHead = heads.has(u.id)
    const since = sinceByProfile[u.id]
    const soon = upcomingByProfile[u.id]
    const isDragging = dragging === u.id
    const menuOpen = menuFor === u.id
    return (
      <div className={`group relative border-t border-bank-line first:border-t-0 ${isDragging ? 'opacity-35' : ''}`}>
        <div className={`flex items-center gap-2 px-2 py-2 min-h-[44px] ${draggable(u) ? 'cursor-grab active:cursor-grabbing' : ''}`} {...dragProps(u)}>
          {draggable(u)
            ? <GripVertical size={12} className="text-bank-fa flex-shrink-0 hidden md:block" />
            : <span className="w-3 flex-shrink-0 hidden md:block" />}
          <div className={`rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${isHead ? 'w-[34px] h-[34px] text-bank-gold-tx' : 'w-[30px] h-[30px] text-bank-mu'}`}
            style={isHead ? GOLD_WASH : SURFACE.well}>
            {initialsOf(u.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Names WRAP rather than truncate — a roster where you can't read
                  who's who is useless. Only the email/since subline clips. */}
              <span className={`text-[13px] leading-tight break-words ${isHead ? 'font-bold text-bank-tx' : 'font-semibold text-bank-tx'}`}>{u.name}</span>
              {(!inTeam || u.role !== 'rep') && <span className={`text-[12px] font-bold uppercase tracking-wide ${ROLE_COLOR[u.role] || 'text-bank-mu'}`}>{u.role}</span>}
              {u.is_admin && u.role !== 'admin' && (
                <span className="inline-flex items-center gap-0.5 text-[12px] font-bold uppercase tracking-wide px-1 rounded text-bank-tx" style={badge('var(--tx)')}>
                  <ShieldCheck size={9} /> admin
                </span>
              )}
              {u.ghost && <span className="text-[12px] font-bold uppercase tracking-wide px-1 rounded text-bank-mu" style={badge('var(--mu)')}>ghost</span>}
              {!u.auth_id && <span className="text-[12px] font-bold uppercase tracking-wide px-1 rounded" style={badge(WARN)}>no login</span>}
            </div>
            <p className="text-[13px] text-bank-fa truncate mt-0.5">
              {isHead ? u.email : (since ? `since ${fmtDay(since)}` : u.email)}
            </p>
            {/* Where they're GOING, when a move is already scheduled. */}
            {soon && (
              <p className="text-[13px] mt-0.5 truncate flex items-center gap-1 text-bank-mu">
                <CalendarClock size={10} className="flex-shrink-0" />
                → {soon.new_manager_id ? teamLabel(users.find(x => x.id === soon.new_manager_id)) : 'Unassigned'}
                <span className="text-bank-fa">on {fmtDay(soon.effective_date)}</span>
              </p>
            )}
          </div>
          {/* Desktop: icons appear on hover as an OVERLAY at the right edge, so
              they reserve no width at rest — three always-present icons were
              what crammed the names. A soft fade masks whatever sits under
              them. Phone: a ⋯ that opens a row below. */}
          <div className="hidden md:group-hover:flex md:focus-within:flex absolute right-1 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg pl-1 pr-0.5"
            style={{ background: 'var(--card)', boxShadow: '-16px 0 14px -6px var(--card)' }}>
            <Actions u={u} />
          </div>
          <IconButton onClick={() => setMenuFor(menuOpen ? null : u.id)} aria-expanded={menuOpen} aria-label={`Actions for ${u.name}`}
            className="md:hidden flex-shrink-0">
            <MoreHorizontal size={15} />
          </IconButton>
        </div>
        {menuOpen && (
          <div className="md:hidden flex items-center gap-1.5 px-3 pb-2.5 flex-wrap">
            <Actions u={u} />
            {draggable(u) && (
              <select value="" onChange={e => { const v = e.target.value; setMenuFor(null); if (v) onMove?.(u, v === 'unassigned' ? null : v) }}
                aria-label="Move to"
                className="h-11 px-2 rounded-lg text-[13px] text-bank-tx focus:outline-none appearance-none"
                style={SURFACE.raise}>
                <option value="">Move to…</option>
                {moveTargets.filter(t => t.value !== colKeyOf(u)).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                {colKeyOf(u) !== 'unassigned' && <option value="unassigned">Unassigned</option>}
              </select>
            )}
          </div>
        )}
      </div>
    )
  }

  function Actions({ u }) {
    return (
      <>
        {u.auth_id
          ? (hasUserAdmin && <IconButton onClick={() => onResetLogin?.(u)} disabled={busyUser === u.id} title="Reset their password" aria-label="Reset their password" className="hover:!text-bank-warn"><KeyRound size={13} /></IconButton>)
          : (hasUserAdmin && <IconButton onClick={() => onCreateLogin?.(u)} disabled={busyUser === u.id} title="No login yet — create one" aria-label="Create their login"><UserPlus size={13} /></IconButton>)}
        <IconButton onClick={() => onEdit?.(u)} title="Edit" aria-label={`Edit ${u.name}`}><Pencil size={13} /></IconButton>
        {/* Deactivate is the normal way someone LEAVES — it cuts their login
            while every deal, appointment and payout they touched stays put.
            It sat only in the old Users list, so when this chart replaced that
            list the action vanished and Delete was the only exit on the row.
            Delete stays, but Deactivate comes first because it is what you
            almost always want. */}
        <IconButton onClick={() => onToggleActive?.(u)} title="Deactivate — cuts their login, keeps all their deals and stats" aria-label={`Deactivate ${u.name}`}
          className="hover:!text-bank-warn"><UserMinus size={13} /></IconButton>
        <IconButton onClick={() => onDelete?.(u.id)} title="Delete from the roster — only for a row created by mistake" aria-label={`Delete ${u.name}`} className="hover:!text-bank-neg"><Trash2 size={13} /></IconButton>
      </>
    )
  }

  // ── A team column (head card + members), a drop target ──
  function Column({ colKey, head, title, meta, people, tone }) {
    const shown = people.filter(match)
    const headShown = head ? match(head) : false
    if (q && !shown.length && !headShown) return null
    const isOver = over === colKey && dragUser && colKeyOf(dragUser) !== colKey
    const closed = isCollapsed(colKey)
    const amber = tone === 'amber'
    return (
      <div className="rounded-2xl overflow-hidden transition-shadow" {...dropProps(colKey)}
        style={{ ...card, borderStyle: amber ? 'dashed' : 'solid',
                 borderColor: isOver ? 'var(--gold)' : amber ? 'rgba(210,160,116,0.5)' : 'var(--line)',
                 boxShadow: isOver ? 'inset 0 0 0 3px rgba(191,164,108,0.18)' : 'var(--card-shadow)' }}>
        <div className="flex items-center gap-2 px-2.5 py-2" style={{ borderBottom: closed ? 'none' : '1px solid var(--line)' }}>
          <IconButton onClick={() => toggleCol(colKey)} aria-expanded={!closed} title={closed ? 'Expand' : 'Collapse'} aria-label={closed ? 'Expand' : 'Collapse'}
            className="-ml-1 flex-shrink-0 md:!p-1">
            <ChevronDown size={13} className={`transition-transform ${closed ? '-rotate-90' : ''}`} />
          </IconButton>
          {head ? (
            // The column is titled by the lead's FULL NAME (per Keaton — an
            // initials bubble squeezed between a chevron and a count badge
            // read as an abbreviation). Role + admin/login badges sit under it.
            <div className="group relative min-w-0 flex-1 py-0.5">
              {/* The header is ONLY the team's name (profiles.team_name, editable
                  right here — click it; falls back to "<Head>'s Team"). The
                  manager is a normal card pinned to the top of the list below,
                  with the same hover actions as every rep — per Keaton, so
                  editing them isn't a hunt for a tiny control. */}
              {renaming === head.id ? (
                <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                  placeholder={`${head.name}'s Team`} aria-label="Team name"
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(head); if (e.key === 'Escape') setRenaming(null) }}
                  onBlur={() => commitRename(head)}
                  className="font-bold" style={{ ...SURFACE.raise, borderColor: 'rgba(191,164,108,0.5)' }} />
              ) : (
                <button type="button" onClick={() => startRename(head)}
                  title={head.team_name ? 'Rename team' : 'Name this team'}
                  className="text-left flex items-start gap-1.5 max-w-full min-h-[44px] md:min-h-0">
                  <span className={`text-[13.5px] font-bold leading-tight break-words ${head.team_name ? 'text-bank-tx' : 'text-bank-mu'}`}>{teamLabel(head)}</span>
                  <Pencil size={12} className="mt-0.5 text-bank-fa group-hover:text-bank-gold-tx flex-shrink-0 transition-colors" />
                </button>
              )}
            </div>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2 py-1">
              <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                style={{ background: 'var(--bg)', border: '1px solid rgba(210,160,116,0.45)', color: WARN }}>?</div>
              <div className="min-w-0"><p className="text-[13px] font-bold truncate" style={{ color: WARN }}>{title}</p><p className="text-[13px] text-bank-fa truncate">{meta}</p></div>
            </div>
          )}
          <span className="text-[13px] font-bold text-bank-mu px-2 py-0.5 rounded-full flex-shrink-0 tabular-nums" style={SURFACE.raise}>{people.length}</span>
        </div>
        {!closed && (
          <div>
            {head && match(head) && <Person u={head} inTeam={false} />}
            {isOver && (
              <div className="m-2 h-10 rounded-lg flex items-center justify-center text-[13px] font-semibold text-bank-gold-tx"
                style={{ ...GOLD_WASH, borderStyle: 'dashed' }}>
                Drop to move to {head ? head.name : 'Unassigned'}
              </div>
            )}
            {shown.length === 0 && !isOver
              ? <p className="px-3 py-3 text-[13px] text-bank-mu text-center">{amber ? 'Everyone has a team.' : 'No reps yet — drag someone here.'}</p>
              : shown.map(u => <Person key={u.id} u={u} />)}
          </div>
        )}
      </div>
    )
  }

  const label = 'text-[13px] font-semibold text-bank-fa uppercase tracking-wide flex items-center gap-2 after:content-[""] after:flex-1 after:h-px after:bg-bank-line'
  const leadersShown = leadership.filter(match)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…" aria-label="Search people" className="pl-9" />
        </div>
        <p className="text-[13px] text-bank-mu">{active.length} people · {teams.length} team{teams.length === 1 ? '' : 's'}</p>
        {inactive.length > 0 && (
          <SecondaryButton onClick={toggleDrawer} style={{ color: NEG, borderColor: 'rgba(217,140,128,0.45)' }}>
            Deactivated · {inactive.length}
          </SecondaryButton>
        )}
        {/* "Move people" is the deliberate path for a reorg: several people at
            once, with an EFFECTIVE DATE and a preview of what changes hands.
            Dragging a card stays for the one-off fix and still means "today". */}
        <SecondaryButton onClick={() => onMovePeople?.()} className="ml-auto">
          <ArrowRightLeft size={13} /> Move people
        </SecondaryButton>
        <PrimaryButton onClick={onAdd} className="px-3 py-2 min-h-[44px] md:min-h-0">
          <Plus size={13} /> Add person
        </PrimaryButton>
      </div>

      {/* Leadership */}
      {leadersShown.length > 0 && (
        <>
          <p className={label}>Leadership</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', maxWidth: 820 }}>
            {leadersShown.map(u => (
              <div key={u.id} className="rounded-2xl px-1" style={card}><Person u={u} inTeam={false} /></div>
            ))}
          </div>
        </>
      )}

      {/* Teams — Unassigned is a column like any other */}
      <p className={label}>Teams</p>
      <div className="grid gap-2 md:gap-2.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
        {teams.map(({ head, members }) => (
          <Column key={head.id} colKey={head.id} head={head} people={members} />
        ))}
        <Column colKey="unassigned" title="Unassigned" meta="no team lead — drag them to a team" people={unassigned} tone="amber" />
      </div>
      <p className="text-[13px] text-bank-fa">
        Drag a rep onto another team for a quick one-off move — effective <strong className="text-bank-mu">today</strong>, so their
        past sales stay where they were. For a reorg use <strong className="text-bank-mu">Move people</strong>: several at
        once, any effective date (including a future one), and it shows you how many deals change hands first.
      </p>

      {/* Deactivated drawer */}
      {inactive.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ ...card, borderColor: 'rgba(217,140,128,0.4)' }}>
          <button onClick={toggleDrawer} aria-expanded={drawerOpen}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] text-left hover:bg-bank-raise transition-colors"
            style={{ borderBottom: drawerOpen ? '1px solid var(--line)' : 'none' }}>
            <ChevronDown size={13} className={`text-bank-fa transition-transform ${drawerOpen ? '' : '-rotate-90'}`} />
            <span className="text-[13px] font-bold" style={{ color: NEG }}>Deactivated · {inactive.length}</span>
            <span className="ml-auto text-[13px] text-bank-fa hidden sm:inline">Their deals and stats still count everywhere. Reactivate restores login + site access.</span>
          </button>
          {drawerOpen && inactive.filter(match).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 px-3 py-2 min-h-[44px] border-t border-bank-line flex-wrap">
              <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 text-bank-fa"
                style={SURFACE.well}>{initialsOf(u.name)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-semibold text-bank-mu leading-tight break-words">{u.name}</span>
                  <span className={`text-[12px] font-bold uppercase tracking-wide ${ROLE_COLOR[u.role] || 'text-bank-mu'}`}>{u.role}</span>
                  <span className="text-[12px] font-bold uppercase tracking-wide px-1 rounded" style={badge(NEG)}>deactivated</span>
                </div>
                <p className="text-[13px] text-bank-fa truncate mt-0.5">
                  {u.manager_id && nameOf(u.manager_id) ? `was on ${teamLabel(users.find(x => x.id === u.manager_id))}` : 'no team'} · {u.email}
                </p>
              </div>
              <SecondaryButton onClick={() => onToggleActive?.(u)} title="Restore site access — their deals and stats never left" className="flex-shrink-0">
                <UserCheck size={11} /> Reactivate
              </SecondaryButton>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <IconButton onClick={() => onEdit?.(u)} title="Edit" aria-label={`Edit ${u.name}`}><Pencil size={13} /></IconButton>
                <IconButton onClick={() => onDelete?.(u.id)} title="Delete" aria-label={`Delete ${u.name}`} className="hover:!text-bank-neg"><Trash2 size={13} /></IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
