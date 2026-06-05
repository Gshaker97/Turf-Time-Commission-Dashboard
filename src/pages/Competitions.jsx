import { useEffect, useMemo, useState } from 'react'
import { Trophy, Plus, Pencil, Trash2, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import { fetchCompetitions, fetchDeals, fetchUsers, insertCompetition, updateCompetition, deleteCompetition } from '../lib/db'
import { competitionStandings, competitionStatus, typeLabel, metricLabel, fmtScore } from '../utils/competition'
import CompetitionModal from '../components/CompetitionModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtRange = (a, b) => {
  const f = (d) => d ? format(new Date(d + 'T12:00:00'), 'MMM d') : null
  if (!a && !b) return 'No date range'
  if (a && b) return `${f(a)} – ${f(b)}`
  return a ? `From ${f(a)}` : `Through ${f(b)}`
}
const STATUS = {
  active:   { label: 'Active',   color: '#00b894' },
  upcoming: { label: 'Upcoming', color: '#fdcb6e' },
  ended:    { label: 'Ended',    color: '#94a3b8' },
}
const RANK_COLOR = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fb923c' }

function StandRow({ e, metric, mine }) {
  const rc = RANK_COLOR[e.rank]
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={mine ? { background: '#00b89415', border: '1px solid #00b89430' } : undefined}>
      <span className="w-6 text-center text-[12px] font-bold flex-shrink-0" style={{ color: rc || 'rgba(255,255,255,0.4)' }}>
        {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
      </span>
      <span className="flex-1 min-w-0 truncate text-[13px] text-white/85">{e.name}{mine && <span className="text-teal text-[11px]"> · you</span>}</span>
      {e.manual && <span className="text-[9px] uppercase text-white/30 tracking-wide">manual</span>}
      <span className="text-[13px] font-bold text-white whitespace-nowrap">{fmtScore(e.score, metric)}</span>
    </div>
  )
}

function CompetitionCard({ comp, deals, users, profileId, canManage, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const standings = useMemo(() => competitionStandings(comp, deals, users), [comp, deals, users])
  const status = competitionStatus(comp, todayISO())
  const st = STATUS[status]
  const isMine = (e) => e.id === profileId || (comp.type === 'team' && users.find(u => u.id === profileId)?.manager_id === e.id)
  const myEntry = standings.find(isMine)
  const top = open ? standings : standings.slice(0, 5)

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[15px] font-bold text-white truncate">{comp.name}</h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: st.color, border: `1px solid ${st.color}40` }}>{st.label}</span>
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">
              {typeLabel(comp.type)} · {metricLabel(comp.metric)} · {fmtRange(comp.start_date, comp.end_date)}
            </p>
            {comp.description && <p className="text-[12px] text-white/55 mt-1.5">{comp.description}</p>}
          </div>
          {canManage && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => onEdit(comp)} className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors" title="Edit"><Pencil size={13} /></button>
              <button onClick={() => onDelete(comp)} className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete"><Trash2 size={13} /></button>
            </div>
          )}
        </div>

        {/* Standings */}
        <div className="mt-3 space-y-0.5">
          {standings.length === 0 ? (
            <p className="text-[12px] text-white/30 px-3 py-2">No participants yet.</p>
          ) : (
            top.map(e => <StandRow key={e.id} e={e} metric={comp.metric} mine={isMine(e)} />)
          )}
          {/* If the viewer is outside the visible top and not shown, pin their row */}
          {!open && myEntry && myEntry.rank > 5 && (
            <>
              <p className="text-center text-white/20 text-[11px]">···</p>
              <StandRow e={myEntry} metric={comp.metric} mine />
            </>
          )}
        </div>

        {(standings.length > 5 || comp.rules) && (
          <button onClick={() => setOpen(o => !o)}
            className="mt-2 flex items-center gap-1 text-[11px] text-white/40 hover:text-white transition-colors">
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? 'Show less' : (standings.length > 5 ? `Show all ${standings.length}` : 'Details')}
          </button>
        )}

        {open && comp.rules && (
          <div className="mt-3 rounded-lg p-3 text-[12px] text-white/60 leading-snug" style={{ background: '#171717', border: '1px solid #262626' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1">Rules</p>
            {comp.rules}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Competitions() {
  const { profile } = useAuth()
  const canManage = ['vp', 'admin'].includes(profile?.role)
  const [comps, setComps] = useState([])
  const [deals, setDeals] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editComp, setEditComp] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: c }, { data: d }, { data: u }] = await Promise.all([fetchCompetitions(), fetchDeals(), fetchUsers()])
    setComps(c || []); setDeals(d || []); setUsers(u || []); setLoading(false)
  }

  const sorted = useMemo(() => {
    const rank = { active: 0, upcoming: 1, ended: 2 }
    return [...comps].sort((a, b) => rank[competitionStatus(a, todayISO())] - rank[competitionStatus(b, todayISO())])
  }, [comps])

  async function handleSave(data) {
    if (editComp) {
      setComps(cs => cs.map(c => c.id === editComp.id ? { ...c, ...data } : c))
      await updateCompetition(editComp.id, data)
    } else {
      await insertCompetition(data, profile?.id)
    }
    setModal(false); setEditComp(null); load()
  }
  async function handleDelete(comp) {
    if (!confirm(`Delete the competition "${comp.name}"? This cannot be undone.`)) return
    setComps(cs => cs.filter(c => c.id !== comp.id))
    const res = await deleteCompetition(comp.id)
    if (res?.error) load()
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><Trophy size={18} className="text-teal" /> Competitions</h1>
          <p className="text-[12px] text-white/40 mt-0.5">See how you stack up in the contests we're running.</p>
        </div>
        {canManage && (
          <button onClick={() => { setEditComp(null); setModal(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-dark bg-teal hover:bg-teal-dark transition-colors">
            <Plus size={15} /> New
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-white/30 text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl p-10 text-center text-white/40 text-[13px]" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          No competitions yet.{canManage ? ' Click “New” to start one.' : ' Check back soon!'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sorted.map(comp => (
            <CompetitionCard key={comp.id} comp={comp} deals={deals} users={users}
              profileId={profile?.id} canManage={canManage}
              onEdit={(c) => { setEditComp(c); setModal(true) }} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {modal && (
        <CompetitionModal competition={editComp} users={users}
          onSave={handleSave} onClose={() => { setModal(false); setEditComp(null) }} />
      )}
    </div>
  )
}
