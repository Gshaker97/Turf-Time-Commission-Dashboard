import { useEffect, useMemo, useState } from 'react'
import {
  Search, Plus, KeyRound, UserPlus, Pencil, Trash2, UserCheck, ShieldCheck,
  ChevronDown, GripVertical, MoreHorizontal,
} from 'lucide-react'
import { headIdSet } from '../utils/team'

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
//   • Phones: columns stack and each becomes collapsible; row actions fold
//     into a ⋯ menu that also offers "Move to…" since touch has no drag.
// Presentational + drag state only — every write goes back up as a handler.
// ============================================================

const COLLAPSE_KEY = 'tt_people_collapsed'
const DRAWER_KEY   = 'tt_people_deactivated_open'
const card = { background: '#1e1e1e', border: '1px solid #2a2a2a' }
const ROLE_COLOR = { admin: 'text-teal', vp: 'text-amber-400', director: 'text-violet-400', manager: 'text-blue-300', rep: 'text-white/40' }
const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

export default function PeopleChart({
  users = [], teamChanges = [], hasUserAdmin = false, busyUser = '',
  onAdd, onEdit, onDelete, onToggleActive, onResetLogin, onCreateLogin, onMove,
}) {
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

  // Latest logged move per person → "since <date>" on their card.
  const sinceByProfile = useMemo(() => {
    const m = {}
    for (const c of teamChanges) if (!m[c.profile_id]) m[c.profile_id] = c.changed_at
    return m
  }, [teamChanges])
  const fmtSince = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  const moveTargets = teams.map(t => ({ value: t.head.id, label: t.head.role === 'manager' ? `${t.head.name}'s team` : `${t.head.name}'s directs` }))

  // ── One person card ──
  function Person({ u, inTeam = true }) {
    const isHead = heads.has(u.id)
    const since = sinceByProfile[u.id]
    const isDragging = dragging === u.id
    const menuOpen = menuFor === u.id
    return (
      <div className={`group relative border-t border-white/5 first:border-t-0 ${isDragging ? 'opacity-35' : ''}`}>
        <div className={`flex items-center gap-2 px-2 py-2 ${draggable(u) ? 'cursor-grab active:cursor-grabbing' : ''}`} {...dragProps(u)}>
          {draggable(u)
            ? <GripVertical size={12} className="text-white/15 flex-shrink-0 hidden md:block" />
            : <span className="w-3 flex-shrink-0 hidden md:block" />}
          <div className={`rounded-full flex items-center justify-center text-[10.5px] font-bold flex-shrink-0 ${isHead ? 'w-[34px] h-[34px]' : 'w-[30px] h-[30px]'}`}
            style={{ background: '#1a1a1a', border: `1px solid ${isHead ? 'rgba(0,184,148,0.45)' : '#333'}`, color: '#00b894' }}>
            {initialsOf(u.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Names WRAP rather than truncate — a roster where you can't read
                  who's who is useless. Only the email/since subline clips. */}
              <span className={`text-[12.5px] leading-tight break-words ${isHead ? 'font-bold text-white' : 'font-semibold text-white/85'}`}>{u.name}</span>
              {(!inTeam || u.role !== 'rep') && <span className={`text-[8.5px] font-bold uppercase tracking-wide ${ROLE_COLOR[u.role] || 'text-white/40'}`}>{u.role}</span>}
              {u.is_admin && u.role !== 'admin' && (
                <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#00b894', border: '1px solid #00b89455' }}>
                  <ShieldCheck size={8} /> admin
                </span>
              )}
              {u.ghost && <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#a78bfa', border: '1px solid #a78bfa55' }}>ghost</span>}
              {!u.auth_id && <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#f59e0b', border: '1px solid #f59e0b55' }}>no login</span>}
            </div>
            <p className="text-[10px] text-white/30 truncate mt-0.5">
              {isHead ? u.email : (since ? `since ${fmtSince(since)}` : u.email)}
            </p>
          </div>
          {/* Desktop: icons appear on hover as an OVERLAY at the right edge, so
              they reserve no width at rest — three always-present icons were
              what crammed the names. A soft fade masks whatever sits under
              them. Phone: a ⋯ that opens a row below. */}
          <div className="hidden md:group-hover:flex absolute right-1 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg pl-1 pr-0.5"
            style={{ background: '#1e1e1e', boxShadow: '-16px 0 14px -6px #1e1e1e' }}>
            <Actions u={u} />
          </div>
          <button onClick={() => setMenuFor(menuOpen ? null : u.id)} aria-expanded={menuOpen}
            className="md:hidden p-1.5 rounded-lg text-white/40 hover:text-white flex-shrink-0">
            <MoreHorizontal size={15} />
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden flex items-center gap-1.5 px-3 pb-2.5 flex-wrap">
            <Actions u={u} />
            {draggable(u) && (
              <select value="" onChange={e => { const v = e.target.value; setMenuFor(null); if (v) onMove?.(u, v === 'unassigned' ? null : v) }}
                className="h-7 px-2 rounded-lg text-[11px] text-white/80 focus:outline-none appearance-none"
                style={{ background: '#242424', border: '1px solid #333' }}>
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
    const act = 'p-1.5 rounded-lg text-white/40 hover:text-white transition-colors disabled:opacity-40'
    return (
      <>
        {u.auth_id
          ? (hasUserAdmin && <button onClick={() => onResetLogin?.(u)} disabled={busyUser === u.id} title="Reset their password" className={`${act} hover:text-amber-400 hover:bg-amber-500/10`}><KeyRound size={13} /></button>)
          : (hasUserAdmin && <button onClick={() => onCreateLogin?.(u)} disabled={busyUser === u.id} title="No login yet — create one" className={`${act} hover:text-teal hover:bg-teal/10`}><UserPlus size={13} /></button>)}
        <button onClick={() => onEdit?.(u)} title="Edit" className={`${act} hover:text-teal hover:bg-teal/10`}><Pencil size={13} /></button>
        <button onClick={() => onDelete?.(u.id)} title="Delete" className={`${act} hover:text-red-400 hover:bg-red-500/10`}><Trash2 size={13} /></button>
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
      <div className="rounded-xl overflow-hidden transition-shadow" {...dropProps(colKey)}
        style={{ ...card, borderStyle: amber ? 'dashed' : 'solid',
                 borderColor: isOver ? 'rgba(0,184,148,0.7)' : amber ? 'rgba(245,158,11,0.4)' : '#2a2a2a',
                 boxShadow: isOver ? 'inset 0 0 0 3px rgba(0,184,148,0.15)' : 'none' }}>
        <div className="flex items-center gap-2 px-2.5 py-2" style={{ borderBottom: closed ? 'none' : '1px solid #2a2a2a' }}>
          <button onClick={() => toggleCol(colKey)} aria-expanded={!closed} title={closed ? 'Expand' : 'Collapse'}
            className="p-1 -ml-1 rounded text-white/30 hover:text-white flex-shrink-0">
            <ChevronDown size={13} className={`transition-transform ${closed ? '-rotate-90' : ''}`} />
          </button>
          {head ? (
            // The column is titled by the lead's FULL NAME (per Keaton — an
            // initials bubble squeezed between a chevron and a count badge
            // read as an abbreviation). Role + admin/login badges sit under it.
            <div className="group relative min-w-0 flex-1 py-0.5">
              <p className="text-[13.5px] font-bold text-white leading-tight break-words pr-1">{head.name}</p>
              <p className="text-[10px] text-white/35 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className={`font-bold uppercase tracking-wide ${ROLE_COLOR[head.role] || 'text-white/40'}`}>{head.role}</span>
                {meta && <span>· {meta}</span>}
                {head.is_admin && head.role !== 'admin' && (
                  <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#00b894', border: '1px solid #00b89455' }}>
                    <ShieldCheck size={8} /> admin
                  </span>
                )}
                {!head.auth_id && <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#f59e0b', border: '1px solid #f59e0b55' }}>no login</span>}
              </p>
              <div className="hidden md:group-hover:flex absolute right-0 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg pl-1"
                style={{ background: '#1e1e1e', boxShadow: '-16px 0 14px -6px #1e1e1e' }}>
                <Actions u={head} />
              </div>
              <button onClick={() => setMenuFor(menuFor === head.id ? null : head.id)} aria-expanded={menuFor === head.id}
                className="md:hidden absolute right-0 top-0 p-1 rounded-lg text-white/40 hover:text-white">
                <MoreHorizontal size={15} />
              </button>
              {menuFor === head.id && <div className="md:hidden flex items-center gap-1.5 pt-1.5"><Actions u={head} /></div>}
            </div>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2 py-1">
              <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                style={{ background: '#1a1a1a', border: '1px solid rgba(245,158,11,0.45)', color: '#f59e0b' }}>?</div>
              <div className="min-w-0"><p className="text-[13px] font-bold truncate" style={{ color: '#f59e0b' }}>{title}</p><p className="text-[10px] text-white/30 truncate">{meta}</p></div>
            </div>
          )}
          <span className="text-[11px] font-bold text-white/60 px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#242424', border: '1px solid #2a2a2a' }}>{people.length}</span>
        </div>
        {!closed && (
          <div>
            {isOver && (
              <div className="m-2 h-10 rounded-lg flex items-center justify-center text-[11px] font-semibold"
                style={{ border: '1.5px dashed rgba(0,184,148,0.6)', color: '#00b894', background: 'rgba(0,184,148,0.06)' }}>
                Drop to move to {head ? head.name : 'Unassigned'}
              </div>
            )}
            {shown.length === 0 && !isOver
              ? <p className="px-3 py-3 text-[11px] text-white/25 text-center">{amber ? 'Everyone has a team.' : 'No reps yet — drag someone here.'}</p>
              : shown.map(u => <Person key={u.id} u={u} />)}
          </div>
        )}
      </div>
    )
  }

  const label = 'text-[9.5px] font-semibold text-white/30 uppercase tracking-widest flex items-center gap-2 after:content-[""] after:flex-1 after:h-px after:bg-[#2a2a2a]'
  const leadersShown = leadership.filter(match)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 rounded-xl text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-teal/40 transition-colors"
            style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }} />
        </div>
        <p className="text-[12px] text-white/40">{active.length} people · {teams.length} team{teams.length === 1 ? '' : 's'}</p>
        {inactive.length > 0 && (
          <button onClick={toggleDrawer} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-300 transition-colors"
            style={{ border: '1px solid #f8717166', background: '#f871711a' }}>
            Deactivated · {inactive.length}
          </button>
        )}
        <button onClick={onAdd} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal transition-colors">
          <Plus size={13} /> Add person
        </button>
      </div>

      {/* Leadership */}
      {leadersShown.length > 0 && (
        <>
          <p className={label}>Leadership</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', maxWidth: 820 }}>
            {leadersShown.map(u => (
              <div key={u.id} className="rounded-xl px-1" style={card}><Person u={u} inTeam={false} /></div>
            ))}
          </div>
        </>
      )}

      {/* Teams — Unassigned is a column like any other */}
      <p className={label}>Teams</p>
      <div className="grid gap-2 md:gap-2.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
        {teams.map(({ head, members }) => (
          <Column key={head.id} colKey={head.id} head={head} people={members}
            meta={head.role === 'manager' ? null : `led by their ${head.role}`} />
        ))}
        <Column colKey="unassigned" title="Unassigned" meta="no team lead — drag them to a team" people={unassigned} tone="amber" />
      </div>
      <p className="text-[10px] text-white/25">
        Drag a rep onto another team to move them — you'll confirm first, and the move is date-stamped so past sales stay where they were.
        Team leads move through Edit (that's where the "move their reports too?" question lives).
      </p>

      {/* Deactivated drawer */}
      {inactive.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ ...card, borderColor: 'rgba(248,113,113,0.35)' }}>
          <button onClick={toggleDrawer} aria-expanded={drawerOpen}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
            style={{ borderBottom: drawerOpen ? '1px solid #2a2a2a' : 'none' }}>
            <ChevronDown size={13} className={`text-white/30 transition-transform ${drawerOpen ? '' : '-rotate-90'}`} />
            <span className="text-[12.5px] font-bold" style={{ color: '#fca5a5' }}>Deactivated · {inactive.length}</span>
            <span className="ml-auto text-[10.5px] text-white/30 hidden sm:inline">Their deals and stats still count everywhere. Reactivate restores login + site access.</span>
          </button>
          {drawerOpen && inactive.filter(match).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 px-3 py-2 border-t border-white/5">
              <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[10.5px] font-bold flex-shrink-0"
                style={{ background: '#1a1a1a', border: '1px solid #333', color: 'rgba(255,255,255,0.35)' }}>{initialsOf(u.name)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-white/60 leading-tight break-words">{u.name}</span>
                  <span className={`text-[8.5px] font-bold uppercase tracking-wide ${ROLE_COLOR[u.role] || 'text-white/40'}`}>{u.role}</span>
                  <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 rounded" style={{ color: '#f87171', border: '1px solid #f8717155' }}>deactivated</span>
                </div>
                <p className="text-[10px] text-white/30 truncate mt-0.5">
                  {u.manager_id && nameOf(u.manager_id) ? `was on ${nameOf(u.manager_id)}'s team` : 'no team'} · {u.email}
                </p>
              </div>
              <button onClick={() => onToggleActive?.(u)} title="Restore site access — their deals and stats never left"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold text-teal transition-colors hover:bg-teal/10 flex-shrink-0"
                style={{ border: '1px solid #00b89466' }}>
                <UserCheck size={11} /> Reactivate
              </button>
              <div className="hidden md:flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => onEdit?.(u)} title="Edit" className="p-1.5 rounded-lg text-white/30 hover:text-teal hover:bg-teal/10"><Pencil size={13} /></button>
                <button onClick={() => onDelete?.(u.id)} title="Delete" className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
