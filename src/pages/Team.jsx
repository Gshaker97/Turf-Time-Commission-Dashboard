import { useState, useEffect, useMemo } from 'react'
import { format, subMonths, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { fetchDeals, fetchUsers, fetchRepGoals, saveRepGoal, deleteRepGoal, fetchWeeklyStats } from '../lib/db'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useAuth } from '../contexts/AuthContext'
import { getUserCommission, fmt, activeDeals, isCanceled } from '../utils/commission'
import { getPresetRange, presetLabel, weeksInRange, weekStartOf } from '../utils/dateRanges'
import { headIdSet, teamKeyFor } from '../utils/team'
import DateRangeFilter from '../components/DateRangeFilter'
import WeeklyStats from '../components/WeeklyStats'
import { useSettings } from '../contexts/SettingsContext'
import { MessageSquare, Flame, Snowflake, TrendingUp, TrendingDown, Trophy, Pencil, Check, X, Target } from 'lucide-react'

// Individual sellers = reps AND managers. Managers carry their own sales, so
// they show up as individuals on the Team page and their production rolls into
// their own team's totals.
const isSeller = (u) => u.role === 'rep' || u.role === 'manager'

// Close-rate helpers (mirror the Weekly Stats tab so the numbers match).
const closeRate  = (closed, est) => (est > 0 ? (closed / est) * 100 : null)
const ratePct    = (r) => (r == null ? '—' : `${r.toFixed(0)}%`)
function rateColor(r) {
  if (r == null)  return '#6b7280'
  if (r >= 40)    return '#4ade80'
  if (r >= 25)    return '#fbbf24'
  return '#fb923c'
}

function getNoteKey(repId)   { return `turf_note_${repId}` }
function getNote(repId)      { return localStorage.getItem(getNoteKey(repId)) ?? '' }
function saveNote(repId, t)  { localStorage.setItem(getNoteKey(repId), t) }

// Goals are scoped to the current calendar month (they reset each month).
const GOAL_NOW   = new Date()
const GOAL_YEAR  = GOAL_NOW.getFullYear()
const GOAL_MONTH = GOAL_NOW.getMonth() + 1

const TIER_COLOR = { green: '#4ade80', yellow: '#fbbf24', orange: '#fb923c' }

function RepCard({ rep, healthTier, canEdit, canEditGoal, savedGoal, onSaveGoal, onResetGoal }) {
  const { statusColor } = useSettings()
  const [note,        setNote]        = useState(() => getNote(rep.id))
  const [editingNote, setEditingNote] = useState(false)
  const [noteInput,   setNoteInput]   = useState(note)

  // Goal is DB-backed (shared across devices): savedGoal comes from the parent;
  // fall back to the rep's auto goal when none is set.
  const goal = savedGoal != null ? savedGoal : rep.autoGoal
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput,   setGoalInput]   = useState('')

  function submitNote() { saveNote(rep.id, noteInput); setNote(noteInput); setEditingNote(false) }
  function submitGoal() {
    const v = parseFloat(goalInput)
    if (v > 0) onSaveGoal?.(v)
    setEditingGoal(false)
  }
  function resetGoal() { onResetGoal?.(); setEditingGoal(false) }

  const initials    = rep.name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const healthColor = TIER_COLOR[healthTier ?? 'green']
  const pct         = goal > 0 ? (rep.mtdRev / goal) * 100 : 0

  const statusGroups = Object.entries(
    rep.activePipeline.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1
      return acc
    }, {})
  )

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold"
            style={{ background: '#1e1e1e', border: `2px solid ${healthColor}`, color: healthColor }}>
            {initials}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#242424]"
            style={{ background: healthColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white truncate">{rep.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {rep.streak >= 2 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: '#f59e0b22', color: '#f59e0b' }}>
                <Flame size={10} /> {rep.streak}w streak
              </span>
            ) : rep.daysSinceLast !== null && rep.daysSinceLast > 10 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: '#fb923c22', color: '#fb923c' }}>
                <Snowflake size={10} /> {rep.daysSinceLast}d cold
              </span>
            ) : (
              <p className="text-[11px] text-white/35 truncate">{rep.email}</p>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[9px] text-white/25 uppercase tracking-widest">Rank</p>
          <p className="text-[16px] font-bold" style={{ color: healthColor }}>#{rep.rank}</p>
        </div>
      </div>

      {/* Production stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Deals',   value: rep.deals.toString() },
          { label: 'Revenue', value: fmt(rep.revenue) },
          { label: 'Earned',  value: fmt(rep.commission) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg p-2 text-center" style={{ background: '#1e1e1e' }}>
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">{label}</p>
            <p className="text-[11px] font-bold text-white mt-0.5 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Activity stats — estimates, closes, close rate */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg p-2 text-center" style={{ background: '#1e1e1e' }}>
          <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">Estimates</p>
          <p className="text-[11px] font-bold text-white mt-0.5">{rep.totEst}</p>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: '#1e1e1e' }}>
          <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">Closes</p>
          <p className="text-[11px] font-bold text-white mt-0.5">{rep.totCl}</p>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: '#1e1e1e' }}>
          <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">Close %</p>
          <p className="text-[11px] font-bold mt-0.5" style={{ color: rateColor(rep.totRate) }}>{ratePct(rep.totRate)}</p>
        </div>
      </div>

      {/* Self-gen vs lead close-rate split */}
      <div className="flex items-center gap-3 text-[10px] -mt-1">
        <span className="inline-flex items-center gap-1 text-white/40">
          <Target size={10} className="text-[#74b9ff]" /> Self-gen
          <span className="font-bold" style={{ color: rateColor(rep.sgRate) }}>{ratePct(rep.sgRate)}</span>
          <span className="text-white/25">({rep.sgCl}/{rep.sgEst})</span>
        </span>
        <span className="inline-flex items-center gap-1 text-white/40">
          <Target size={10} className="text-[#fbbf24]" /> Lead
          <span className="font-bold" style={{ color: rateColor(rep.ldRate) }}>{ratePct(rep.ldRate)}</span>
          <span className="text-white/25">({rep.ldCl}/{rep.ldEst})</span>
        </span>
      </div>

      {/* Monthly goal progress */}
      <div>
        {editingGoal ? (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] text-white/30 mr-1">Goal $</span>
            <input autoFocus type="number" value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitGoal(); if (e.key === 'Escape') setEditingGoal(false) }}
              className="flex-1 rounded px-2 py-0.5 text-[12px] font-bold text-teal focus:outline-none"
              style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.4)' }} />
            <button onClick={submitGoal} className="text-emerald-400 p-0.5"><Check size={13} /></button>
            <button onClick={() => setEditingGoal(false)} className="text-white/30 p-0.5"><X size={13} /></button>
            {goal !== rep.autoGoal && (
              <button onClick={resetGoal} className="text-[10px] text-white/25 hover:text-white/50 underline">auto</button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/30">MTD Goal</span>
              <span className="text-[10px] text-white/20">{fmt(goal)}</span>
              {canEditGoal && (
                <button onClick={() => { setGoalInput(goal.toFixed(0)); setEditingGoal(true) }}
                  className="text-white/15 hover:text-teal/60 transition-colors">
                  <Pencil size={10} />
                </button>
              )}
            </div>
            <span className="text-[10px] font-semibold" style={{ color: pct >= 100 ? '#4ade80' : '#00b894' }}>
              {pct >= 100 ? '🎯 Hit!' : `${Math.min(pct, 999).toFixed(0)}%`}
            </span>
          </div>
        )}
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? '#4ade80' : '#00b894' }} />
        </div>
      </div>

      {/* Pipeline status */}
      {statusGroups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] text-white/25 uppercase tracking-widest mr-1">Pipeline</span>
          {statusGroups.map(([status, count]) => (
            <span key={status} className="flex items-center gap-1 text-[10px] text-white/50">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor(status) }} />
              {count}
            </span>
          ))}
        </div>
      )}

      {/* Coach note */}
      <div className="border-t border-white/5 pt-3">
        {editingNote ? (
          <div className="flex flex-col gap-2">
            <textarea autoFocus value={noteInput} onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote() }}
              placeholder="Add a coaching note…" rows={2}
              className="w-full rounded-lg px-2.5 py-2 text-[12px] text-white resize-none focus:outline-none"
              style={{ background: '#1e1e1e', border: '1px solid rgba(0,184,148,0.35)' }} />
            <div className="flex gap-1.5">
              <button onClick={submitNote}
                className="flex-1 py-1 rounded text-[11px] font-semibold text-dark"
                style={{ background: '#00b894' }}>Save</button>
              <button onClick={() => { setNoteInput(note); setEditingNote(false) }}
                className="px-3 py-1 rounded text-[11px] text-white/40 hover:text-white hover:bg-white/5">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={canEdit ? () => { setNoteInput(note); setEditingNote(true) } : undefined}
            className={`w-full text-left ${canEdit ? 'group cursor-pointer' : 'cursor-default'}`}>
            <div className="flex items-start gap-2">
              <MessageSquare size={12} className={`mt-0.5 flex-shrink-0 ${canEdit ? 'text-white/20 group-hover:text-teal/60' : 'text-white/10'}`} />
              <p className={`text-[11px] leading-relaxed ${note ? 'text-white/40' : 'text-white/20 italic'} ${canEdit ? 'group-hover:text-white/60' : ''}`}>
                {note || (canEdit ? 'Add coach note…' : 'No notes yet')}
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

export default function Team() {
  const { profile, isAdmin } = useAuth()
  const { statusColor } = useSettings()
  const [deals,           setDeals]           = useState([])
  const [users,           setUsers]           = useState([])
  const [weeklyStats,     setWeeklyStats]     = useState([])
  const [loading,         setLoading]         = useState(true)
  const [tab,             setTab]             = useState('overview')
  const [dateFrom,        setDateFrom]        = useState(getPresetRange('mtd').from)
  const [dateTo,          setDateTo]          = useState(getPresetRange('mtd').to)
  const [activePreset,    setActivePreset]    = useState('mtd')
  const [goalMap,         setGoalMap]         = useState({})   // 'rep:<id>' | 'team:<id>' -> target
  const [editingTeamGoal, setEditingTeamGoal] = useState(false)
  const [teamGoalInput,   setTeamGoalInput]   = useState('')

  // Persisted goals (migration 024) replace the old per-browser localStorage.
  const teamSubject  = ['manager', 'director'].includes(profile?.role) ? profile.id : null
  const teamSavedGoal = teamSubject != null ? goalMap['team:' + teamSubject] : null

  async function persistGoal(subjectId, scope, value) {
    setGoalMap(m => ({ ...m, [`${scope}:${subjectId}`]: value }))   // optimistic
    await saveRepGoal(subjectId, scope, GOAL_YEAR, GOAL_MONTH, value)
  }
  async function clearGoal(subjectId, scope) {
    setGoalMap(m => { const n = { ...m }; delete n[`${scope}:${subjectId}`]; return n })
    await deleteRepGoal(subjectId, scope, GOAL_YEAR, GOAL_MONTH)
  }

  function saveTeamGoal() {
    const v = parseFloat(teamGoalInput)
    if (v > 0 && teamSubject) persistGoal(teamSubject, 'team', v)
    setEditingTeamGoal(false)
  }
  function resetTeamGoal() {
    if (teamSubject) clearGoal(teamSubject, 'team')
    setEditingTeamGoal(false)
  }

  const loadData = () =>
    Promise.all([fetchDeals(), fetchUsers(), fetchRepGoals(GOAL_YEAR, GOAL_MONTH), fetchWeeklyStats()])
      .then(([{ data: d }, { data: u }, { data: g }, { data: ws }]) => {
        setDeals(activeDeals(d ?? [])); setUsers(u ?? [])   // exclude canceled jobs
        setWeeklyStats(ws ?? [])
        const m = {}
        for (const row of g ?? []) if (row.target != null) m[`${row.scope}:${row.subject_id}`] = row.target
        setGoalMap(m)
      })
  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)

  function handleRangeChange({ from, to, preset }) {
    setDateFrom(from); setDateTo(to); setActivePreset(preset)
  }

  const role = profile?.role

  // Ghost users: their deals still count in every total, but their NAME is
  // hidden from non-admins on leaderboards / MVP / recent wins / team headers.
  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users])
  const hideGhost = (id) => !isAdmin && ghostIds.has(id)

  const visibleReps = useMemo(() => {
    if (!profile) return []
    if (role === 'admin' || role === 'vp') return users.filter(isSeller)
    if (role === 'director') {
      const myMgrIds = new Set(users.filter(u => u.director_id === profile.id).map(u => u.id))
      return users.filter(u =>
        (u.role === 'rep' && myMgrIds.has(u.manager_id)) ||
        (u.role === 'manager' && myMgrIds.has(u.id)) ||
        u.manager_id === profile.id)   // reps who report DIRECTLY to this director
    }
    if (role === 'manager') return users.filter(u =>
      u.manager_id === profile.id || u.id === profile.id)   // directs of ANY role (an absorbed manager counts)
    if (role === 'rep') {
      return profile.manager_id
        ? users.filter(u =>
            u.manager_id === profile.manager_id || u.id === profile.manager_id)
        : users.filter(u => u.id === profile.id)
    }
    return []
  }, [users, profile, role])

  // Estimates (manual, from weekly_stats) + closes (from deals) bucketed by the
  // weeks overlapping the selected range — same definitions as the Weekly Stats
  // tab, so the close rate on a card matches that tab.
  const activityByRep = useMemo(() => {
    const weeks   = weeksInRange(dateFrom, dateTo)
    const weekSet = new Set(weeks.map(w => w.weekStart))
    const sgEst = {}, ldEst = {}, sgCl = {}, ldCl = {}
    for (const s of weeklyStats) {
      if (!weekSet.has(s.week_start)) continue
      sgEst[s.rep_id] = (sgEst[s.rep_id] || 0) + (Number(s.self_gen_estimates) || 0)
      ldEst[s.rep_id] = (ldEst[s.rep_id] || 0) + (Number(s.lead_estimates) || 0)
    }
    for (const d of deals) {
      if (!d.sale_date || isCanceled(d)) continue
      const ws = weekStartOf(d.sale_date)
      if (!weekSet.has(ws)) continue
      if (d.setter_id) sgCl[d.setter_id] = (sgCl[d.setter_id] || 0) + 1
      if (d.closer_id && d.closer_id !== d.setter_id) ldCl[d.closer_id] = (ldCl[d.closer_id] || 0) + 1
    }
    const out = {}
    const ids = new Set([...Object.keys(sgEst), ...Object.keys(ldEst), ...Object.keys(sgCl), ...Object.keys(ldCl)])
    for (const id of ids) {
      const se = sgEst[id] || 0, le = ldEst[id] || 0, sc = sgCl[id] || 0, lc = ldCl[id] || 0
      out[id] = {
        sgEst: se, ldEst: le, sgCl: sc, ldCl: lc,
        sgRate: closeRate(sc, se), ldRate: closeRate(lc, le),
        totEst: se + le, totCl: sc + lc, totRate: closeRate(sc + lc, se + le),
      }
    }
    return out
  }, [weeklyStats, deals, dateFrom, dateTo])

  const repStats = useMemo(() => {
    const now    = new Date()
    const curKey = format(now, 'yyyy-MM')
    const blankAct = { sgEst: 0, ldEst: 0, sgCl: 0, ldCl: 0, sgRate: null, ldRate: null, totEst: 0, totCl: 0, totRate: null }
    const rows = visibleReps.map(rep => {
      const allRepDeals  = deals.filter(d => d.setter_id === rep.id || d.closer_id === rep.id)
      const periodDeals  = allRepDeals.filter(d => {
        if (dateFrom && (d.sale_date ?? '') < dateFrom) return false
        if (dateTo   && (d.sale_date ?? '') > dateTo)   return false
        return true
      })
      const revenue    = periodDeals.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      const commission = periodDeals.reduce((s, d) => s + getUserCommission(d, rep.id), 0)
      const trailing   = [1,2,3].map(i => {
        const mk = format(subMonths(now, i), 'yyyy-MM')
        return allRepDeals.filter(d => d.sale_date?.startsWith(mk)).reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      })
      const goal           = (trailing.reduce((s,v) => s+v, 0)/3)*1.1 || 10000
      const mtdRev         = allRepDeals.filter(d => d.sale_date?.startsWith(curKey)).reduce((s,d) => s+(parseFloat(d.baseline_revenue)||0),0)
      const activePipeline = allRepDeals.filter(d => d.status !== 'Paid')
      const sortedDates    = allRepDeals.map(d => d.sale_date).filter(Boolean).sort((a,b) => b.localeCompare(a))
      const lastDate       = sortedDates[0] ?? null
      const daysSinceLast  = lastDate ? Math.max(0, Math.floor((now.getTime()-new Date(lastDate+'T12:00:00').getTime())/86400000)) : null
      let streak  = 0
      let weekPtr = startOfWeek(now, { weekStartsOn: 0 })
      const thisWs = format(weekPtr,'yyyy-MM-dd'), thisWe = format(endOfWeek(weekPtr,{weekStartsOn: 0}),'yyyy-MM-dd')
      if (!allRepDeals.some(d => d.sale_date >= thisWs && d.sale_date <= thisWe)) weekPtr = addDays(weekPtr,-7)
      for (let i=0; i<52; i++) {
        const ws = format(weekPtr,'yyyy-MM-dd'), we = format(endOfWeek(weekPtr,{weekStartsOn: 0}),'yyyy-MM-dd')
        if (!allRepDeals.some(d => d.sale_date >= ws && d.sale_date <= we)) break
        streak++; weekPtr = addDays(weekPtr,-7)
      }
      return { ...rep, deals: periodDeals.length, revenue, commission, mtdRev, autoGoal: goal, activePipeline, daysSinceLast, streak, ...(activityByRep[rep.id] || blankAct) }
    })
    rows.sort((a,b) => b.revenue-a.revenue)
    return rows.map((r,i) => ({...r, rank: i+1}))
  }, [visibleReps, deals, dateFrom, dateTo, activityByRep])

  const teamStats = useMemo(() => {
    if (!profile) return []
    // Team heads via the shared rule (utils/team.js): anyone with direct
    // reports, or a manager reporting to nobody. A manager absorbed into
    // another team (reports to a lead, no directs) is a MEMBER there, not a
    // team of their own.
    const heads = headIdSet(users)
    return users.filter(u => heads.has(u.id) && (isAdmin || !u.ghost)).map(mgr => {
      // ALL members (incl. deactivated) feed the money — an inactive rep's
      // sales still count toward the team. But the "X reps" headcount and
      // rev/rep only reflect ACTIVE members.
      const teamMembers = users.filter(u => u.manager_id === mgr.id && !heads.has(u.id) && isSeller(u))
      const activeReps  = teamMembers.filter(u => u.active !== false)
      const repIds    = new Set([...teamMembers.map(r => r.id), mgr.id])  // include the manager's own sales
      const teamDeals = deals.filter(d => {
        const inPeriod = (!dateFrom||(d.sale_date??'')>=dateFrom)&&(!dateTo||(d.sale_date??'')<=dateTo)
        return inPeriod && (repIds.has(d.setter_id)||repIds.has(d.closer_id))
      })
      const revenue    = teamDeals.reduce((s,d) => s+(parseFloat(d.baseline_revenue)||0), 0)
      // Only what this team's members actually earn on these deals — not the
      // director/VP overrides or an outside setter/closer's share.
      const commission = [...repIds].reduce((s, id) => s + getUserCommission(teamDeals, id), 0)
      return { id: mgr.id, name: mgr.name, reps: activeReps.length, deals: teamDeals.length, revenue, commission, revenuePerRep: activeReps.length>0?revenue/activeReps.length:0, isMyTeam: mgr.id===profile.id }
    }).sort((a,b) => b.revenue-a.revenue)
  }, [users, deals, dateFrom, dateTo, role, profile, isAdmin])

  const maxRevenue = teamStats.reduce((m,t) => Math.max(m,t.revenue), 0)

  const companyRepTiers = useMemo(() => {
    const dayOfMonth  = new Date().getDate()
    if (Math.ceil(dayOfMonth/7) <= 1) return null
    const curKey  = format(new Date(),'yyyy-MM')
    const allReps = users.filter(isSeller)
    if (!allReps.length) return null
    const ranked = allReps.map(rep => ({
      id: rep.id,
      mtdRev: deals.filter(d=>(d.setter_id===rep.id||d.closer_id===rep.id)&&d.sale_date?.startsWith(curKey)).reduce((s,d)=>s+(parseFloat(d.baseline_revenue)||0),0)
    })).sort((a,b)=>b.mtdRev-a.mtdRev)
    const n = ranked.length
    const tierMap = {}
    ranked.forEach((r,i) => {
      const pct=(i+1)/n
      tierMap[r.id]=pct<=0.34?'green':pct<=0.67?'yellow':'orange'
    })
    return tierMap
  }, [users, deals])

  const kpis = useMemo(() => {
    const repIds = new Set(visibleReps.map(r=>r.id))
    const periodDeals = [...new Map(deals.filter(d => {
      const inPeriod=(!dateFrom||(d.sale_date??'')>=dateFrom)&&(!dateTo||(d.sale_date??'')<=dateTo)
      return inPeriod&&(repIds.has(d.setter_id)||repIds.has(d.closer_id))
    }).map(d=>[d.id,d])).values()]
    // Sum what the visible reps personally earn — not every role on the deal
    // (which would lump in director/VP overrides and outsiders' shares).
    const commission = [...repIds].reduce((s, id) => s + getUserCommission(periodDeals, id), 0)
    return { reps: repStats.length, deals: repStats.reduce((s,r)=>s+r.deals,0), revenue: repStats.reduce((s,r)=>s+r.revenue,0), commission }
  }, [repStats, visibleReps, deals, dateFrom, dateTo])

  const paceData = useMemo(() => {
    const now          = new Date()
    const curKey       = format(now,'yyyy-MM')
    const daysInMonth  = new Date(now.getFullYear(),now.getMonth()+1,0).getDate()
    const dayOfMonth   = now.getDate()
    const repIds       = new Set(visibleReps.map(r=>r.id))
    function monthTotal(mk) {
      const uniq = [...new Map(deals.filter(d=>d.sale_date?.startsWith(mk)&&(repIds.has(d.setter_id)||repIds.has(d.closer_id))).map(d=>[d.id,d])).values()]
      return uniq.reduce((s,d)=>s+(parseFloat(d.baseline_revenue)||0),0)
    }
    const mtdRevenue       = monthTotal(curKey)
    const trailing         = [1,2,3].map(i=>monthTotal(format(subMonths(now,i),'yyyy-MM')))
    const autoGoal         = Math.max((trailing.reduce((s,v)=>s+v,0)/3)*1.1,10000)
    const goal             = teamSavedGoal!=null?teamSavedGoal:autoGoal
    const dailyRate        = dayOfMonth>0?mtdRevenue/dayOfMonth:0
    const projectedRevenue = dailyRate*daysInMonth
    const expectedByNow    = goal*(dayOfMonth/daysInMonth)
    const paceVsGoal       = expectedByNow>0?(mtdRevenue/expectedByNow)*100:0
    const pctOfGoal        = Math.min((mtdRevenue/goal)*100,100)
    return { mtdRevenue, projectedRevenue, goal, autoGoal, paceVsGoal, pctOfGoal, dayOfMonth, daysInMonth }
  }, [deals, visibleReps, teamSavedGoal])

  const recentWins = useMemo(() => {
    const repIds = new Set(visibleReps.map(r=>r.id))
    const now    = new Date()
    return deals
      // Hide wins credited to a ghost rep from non-admins (the deal still counts
      // in the KPI/revenue totals above — this is just the named feed).
      .filter(d=>(repIds.has(d.setter_id)||repIds.has(d.closer_id))&&d.sale_date&&d.status!=='Sales Issue'&&!hideGhost(d.closer_id||d.setter_id))
      .sort((a,b)=>(b.sale_date??'').localeCompare(a.sale_date??''))
      .slice(0,8)
      .map(d=>({ ...d, repName: users.find(u=>u.id===(d.closer_id||d.setter_id))?.name??'—', daysAgo: d.sale_date?Math.max(0,Math.floor((now.getTime()-new Date(d.sale_date+'T12:00:00').getTime())/86400000)):0 }))
  }, [deals, visibleReps, users, isAdmin, ghostIds])

  // Reps shown as cards: ghost reps hidden from non-admins, and DEACTIVATED
  // members hidden from everyone — their sales still feed the KPIs/team totals
  // above (which use the unfiltered repStats), they just aren't shown as
  // active members of the team.
  const displayReps = useMemo(
    () => repStats.filter(rep => (isAdmin || !rep.ghost) && rep.active !== false),
    [repStats, isAdmin]
  )

  // Group the cards by team (a manager heads their own team; reps group under
  // their manager) with per-team subtotals. Used when more than one team is in
  // view (e.g. admin/VP/director) so cards aren't a random flat list.
  const teamGroups = useMemo(() => {
    // A ghost manager's name is hidden from non-admins even as a team header.
    const nameOf = (id) => (hideGhost(id) ? null : users.find(u => u.id === id)?.name)
    const groups = {}
    for (const rep of displayReps) {
      const mid = teamKeyFor(rep, headIdSet(users))
      if (!groups[mid]) groups[mid] = { id: mid, name: mid === 'unassigned' ? 'Unassigned' : (nameOf(mid) ? `${nameOf(mid)}'s Team` : 'Team'), rows: [] }
      groups[mid].rows.push(rep)
    }
    const list = Object.values(groups).map(g => {
      const revenue = g.rows.reduce((s, r) => s + r.revenue, 0)
      const dealCnt = g.rows.reduce((s, r) => s + r.deals, 0)
      const est     = g.rows.reduce((s, r) => s + r.totEst, 0)
      const cl      = g.rows.reduce((s, r) => s + r.totCl, 0)
      return { ...g, revenue, deals: dealCnt, rate: closeRate(cl, est) }
    })
    list.sort((a, b) => b.revenue - a.revenue)
    return list
  }, [displayReps, users, isAdmin, ghostIds])
  const groupView = teamGroups.length > 1

  // Weekly Stats roster: the visible sellers PLUS any director/VP who heads a
  // team in view (e.g. Garrison) — they get their own estimate row on their
  // team, like a manager does. Deactivated users stay excluded.
  const weeklyReps = useMemo(() => {
    const base = visibleReps.filter(u => u.active !== false)
    const heads = headIdSet(users)
    const ids = new Set(base.map(u => u.id))
    const out = [...base]
    for (const u of users) {
      if (ids.has(u.id) || u.active === false || !heads.has(u.id)) continue
      if (u.role !== 'director' && u.role !== 'vp') continue
      const leadsSomeoneShown = base.some(m => m.manager_id === u.id)
      if (leadsSomeoneShown || u.id === profile?.id) { out.push(u); ids.add(u.id) }
    }
    return out
  }, [visibleReps, users, profile])

  const topPerformer   = displayReps[0]   // ghost reps already excluded for non-admins
  // Coach notes + weekly stats are admin-only edits. Goals are a carve-out:
  // reps set their own personal goal, managers set their team's goals + their
  // own team goal (handled per-card via canEditGoal and the team-goal pencil).
  const canEditNotes   = isAdmin

  if (loading) return <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading…</div>

  const renderCard = (rep) => (
    <RepCard key={rep.id} rep={rep}
      healthTier={companyRepTiers ? (companyRepTiers[rep.id] ?? 'green') : 'green'}
      canEdit={canEditNotes}
      canEditGoal={isAdmin || profile?.id === rep.id || rep.manager_id === profile?.id}
      savedGoal={goalMap['rep:' + rep.id] ?? null}
      onSaveGoal={(v) => persistGoal(rep.id, 'rep', v)}
      onResetGoal={() => clearGoal(rep.id, 'rep')} />
  )

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'weekly',   label: 'Weekly Stats' },
  ]

  return (
    <div className="space-y-4 pb-8">

      {/* Tabs */}
      <div className="inline-flex gap-1 p-1 rounded-xl"
        style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-1.5 rounded-lg text-[12px] md:text-[13px] font-semibold transition-all ${
              tab === t.key ? 'bg-teal text-dark shadow-sm' : 'text-white/45 hover:text-white hover:bg-white/[0.06]'
            }`}>{t.label}</button>
        ))}
      </div>

      {tab === 'weekly' ? (
        <WeeklyStats deals={deals} reps={weeklyReps} users={users} canEdit={canEditNotes} profileId={profile?.id} />
      ) : (
      <>
      {/* Filter */}
      <DateRangeFilter from={dateFrom} to={dateTo} preset={activePreset} onChange={handleRangeChange} />

      {/* KPI strip — 2-col on mobile */}
      <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
        {[
          { label: 'Reps',       value: kpis.reps.toString() },
          { label: 'Deals',      value: kpis.deals.toString() },
          { label: 'Revenue',    value: fmt(kpis.revenue) },
          { label: 'Comm Earned',value: fmt(kpis.commission) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-3 md:p-4 min-w-0 md:flex-1"
            style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
            <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-[16px] md:text-[20px] font-bold text-teal leading-none truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Month Pace + MVP — stack on mobile */}
      <div className="flex flex-col md:flex-row gap-3">
        {/* Month Pace */}
        <div className="flex-1 rounded-xl px-4 py-4 md:px-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-[13px] font-bold text-white">Month Pace</h3>
              <span className="text-[11px] text-white/30">{format(new Date(),'MMMM')} · Day {paceData.dayOfMonth} of {paceData.daysInMonth}</span>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ background: paceData.paceVsGoal>=100?'#4ade8022':'#fb923c22', color: paceData.paceVsGoal>=100?'#4ade80':'#fb923c' }}>
              {paceData.paceVsGoal>=100?<TrendingUp size={11}/>:<TrendingDown size={11}/>}
              {paceData.paceVsGoal>=100?'+':''}{(paceData.paceVsGoal-100).toFixed(0)}% vs pace
            </span>
          </div>
          <div className="flex items-end gap-4 md:gap-6 mb-3 flex-wrap">
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-0.5">MTD</p>
              <p className="text-[16px] md:text-[18px] font-bold text-white leading-none">{fmt(paceData.mtdRevenue)}</p>
            </div>
            <div className="text-white/20 text-lg">→</div>
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-0.5">On pace for</p>
              <p className="text-[16px] md:text-[18px] font-bold text-teal leading-none">{fmt(paceData.projectedRevenue)}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-0.5">
                Goal {['manager','director'].includes(role)&&!editingTeamGoal&&(
                  <button onClick={()=>{setTeamGoalInput(paceData.goal.toFixed(0));setEditingTeamGoal(true)}}
                    className="ml-1 text-white/20 hover:text-teal/60 align-middle"><Pencil size={10}/></button>
                )}
              </p>
              {editingTeamGoal?(
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-white/30 text-sm">$</span>
                  <input autoFocus type="number" value={teamGoalInput}
                    onChange={e=>setTeamGoalInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')saveTeamGoal();if(e.key==='Escape')setEditingTeamGoal(false)}}
                    className="w-20 rounded px-2 py-0.5 text-[13px] font-bold text-teal text-right focus:outline-none"
                    style={{background:'#1a1a1a',border:'1px solid rgba(0,184,148,0.4)'}}/>
                  <button onClick={saveTeamGoal} className="text-emerald-400 p-0.5"><Check size={13}/></button>
                  <button onClick={()=>setEditingTeamGoal(false)} className="text-white/30 p-0.5"><X size={13}/></button>
                  {paceData.goal!==paceData.autoGoal&&<button onClick={resetTeamGoal} className="text-[10px] text-white/25 underline ml-0.5">auto</button>}
                </div>
              ):(
                <p className="text-[15px] font-semibold text-white/60 leading-none">{fmt(paceData.goal)}</p>
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{background:'#1a1a1a'}}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{width:`${paceData.pctOfGoal}%`,background:paceData.paceVsGoal>=100?'#4ade80':'#00b894'}}/>
          </div>
        </div>

        {/* MVP */}
        {topPerformer && (
          <div className="md:w-56 rounded-xl px-4 py-4 flex items-center gap-3"
            style={{ background: 'linear-gradient(135deg,#fbbf2410,#242424 60%)', border: '1px solid #fbbf2430' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#fbbf2420', border: '2px solid #fbbf24' }}>
              <Trophy size={20} style={{color:'#fbbf24'}}/>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{color:'#fbbf24'}}>MVP · {presetLabel(activePreset)}</p>
              <p className="text-[14px] font-bold text-white truncate">{topPerformer.name}</p>
              <p className="text-[11px] text-white/50">{topPerformer.deals} deals · {fmt(topPerformer.revenue)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Team Comparison — scrollable on mobile */}
      {teamStats.length > 1 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="px-4 md:px-5 py-3.5 border-b border-white/5">
            <h3 className="text-[13px] font-bold text-white">Team Comparison</h3>
            <p className="text-[11px] text-white/30 mt-0.5">Ranked by revenue · {presetLabel(activePreset)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#1e1e1e' }}>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-white/30 uppercase tracking-wider">Team</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-bold text-white/30 uppercase tracking-wider">Deals</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-white/30 uppercase tracking-wider">Revenue</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-white/30 uppercase tracking-wider hidden sm:table-cell">Rev/Rep</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-white/30 uppercase tracking-wider hidden sm:table-cell">Comm</th>
                </tr>
              </thead>
              <tbody>
                {teamStats.map((team, i) => {
                  const revPct = maxRevenue > 0 ? (team.revenue/maxRevenue)*100 : 0
                  return (
                    <tr key={team.id}
                      style={{ background: team.isMyTeam?'rgba(0,184,148,0.07)':i%2===0?'#242424':'#262626', borderLeft: team.isMyTeam?'2px solid #00b894':'2px solid transparent' }}
                      className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ background: i===0?'#fbbf2422':'#1e1e1e', color: i===0?'#fbbf24':'#ffffff55' }}>{i+1}</span>
                          <div>
                            <p className="text-[12px] font-semibold text-white">{team.name}</p>
                            <p className="text-[10px] text-white/30">{team.reps} rep{team.reps!==1?'s':''}</p>
                          </div>
                          {team.isMyTeam&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded hidden sm:inline" style={{background:'#00b89422',color:'#00b894'}}>Your Team</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center"><span className="text-[13px] font-bold text-white">{team.deals}</span></td>
                      <td className="px-4 py-3" style={{minWidth:110}}>
                        <span className="text-[12px] font-bold text-teal">{fmt(team.revenue)}</span>
                        <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{background:'#1a1a1a'}}>
                          <div className="h-full rounded-full" style={{width:`${revPct}%`,background:team.isMyTeam?'#00b894':'#00b89460'}}/>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap hidden sm:table-cell">
                        <span className="text-[12px] font-semibold text-white/70">{fmt(team.revenuePerRep)}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap hidden sm:table-cell">
                        <span className="text-[12px] font-semibold text-white/50">{fmt(team.commission)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rep cards — grouped by team when more than one team is in view */}
      <div>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-[13px] md:text-[14px] font-bold text-white">Rep Performance</h2>
          <p className="text-[11px] text-white/30 hidden sm:block">{groupView ? 'Grouped by team' : 'Ranked by revenue'}</p>
        </div>
        {displayReps.length === 0 ? (
          <p className="py-8 text-center text-white/30 text-[13px]">No reps found for your role.</p>
        ) : groupView ? (
          <div className="space-y-5">
            {teamGroups.map(group => (
              <div key={group.id}>
                <div className="flex items-center justify-between gap-3 mb-2.5 px-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-[13px] font-bold text-white truncate">{group.name}</h3>
                    <span className="text-[11px] text-white/30 flex-shrink-0">{group.rows.length} rep{group.rows.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-3 md:gap-4 text-right flex-shrink-0">
                    <div><p className="text-[9px] uppercase tracking-wider text-white/30">Deals</p><p className="text-[12px] font-bold text-white">{group.deals}</p></div>
                    <div><p className="text-[9px] uppercase tracking-wider text-white/30">Revenue</p><p className="text-[12px] font-bold text-teal">{fmt(group.revenue)}</p></div>
                    <div><p className="text-[9px] uppercase tracking-wider text-white/30">Close %</p><p className="text-[12px] font-bold" style={{ color: rateColor(group.rate) }}>{ratePct(group.rate)}</p></div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                  {group.rows.map(renderCard)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
            {displayReps.map(renderCard)}
          </div>
        )}
      </div>

      {/* Recent Wins */}
      {recentWins.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="px-4 md:px-5 py-3.5 border-b border-white/5">
            <h3 className="text-[13px] font-bold text-white">Recent Team Wins</h3>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recentWins.map(win => (
              <div key={win.id} className="px-4 md:px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.02]">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:statusColor(win.status)}}/>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white truncate">{win.deal_name}</p>
                  <p className="text-[10px] text-white/40 truncate">{win.repName}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[12px] font-bold text-teal">{fmt(parseFloat(win.job_price)||0)}</p>
                  <p className="text-[10px] text-white/30">{win.daysAgo===0?'today':win.daysAgo===1?'yesterday':`${win.daysAgo}d ago`}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
