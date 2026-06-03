import { useState, useEffect, useMemo } from 'react'
import { format, subMonths, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { fetchDeals, fetchUsers } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { getUserCommission, calcDealCommissions, fmt } from '../utils/commission'
import { getPresetRange, presetLabel } from '../utils/dateRanges'
import DateRangeFilter from '../components/DateRangeFilter'
import WeeklyStats from '../components/WeeklyStats'
import { useSettings } from '../contexts/SettingsContext'
import { MessageSquare, Flame, Snowflake, TrendingUp, TrendingDown, Trophy, Pencil, Check, X } from 'lucide-react'

function getNoteKey(repId)   { return `turf_note_${repId}` }
function getNote(repId)      { return localStorage.getItem(getNoteKey(repId)) ?? '' }
function saveNote(repId, t)  { localStorage.setItem(getNoteKey(repId), t) }
function repGoalKey(repId)   { return `turf_repgoal_${repId}_${format(new Date(), 'yyyy-MM')}` }
function teamGoalKey(mgrId)  { return `turf_teamgoal_${mgrId}_${format(new Date(), 'yyyy-MM')}` }

const TIER_COLOR = { green: '#4ade80', yellow: '#fbbf24', orange: '#fb923c' }

function RepCard({ rep, healthTier, canEdit, canEditGoal }) {
  const { statusColor } = useSettings()
  const [note,        setNote]        = useState(() => getNote(rep.id))
  const [editingNote, setEditingNote] = useState(false)
  const [noteInput,   setNoteInput]   = useState(note)

  const gKey = repGoalKey(rep.id)
  const [goal,        setGoal]        = useState(() => {
    const s = localStorage.getItem(gKey)
    return s ? parseFloat(s) : rep.autoGoal
  })
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput,   setGoalInput]   = useState('')

  function submitNote() { saveNote(rep.id, noteInput); setNote(noteInput); setEditingNote(false) }
  function submitGoal() {
    const v = parseFloat(goalInput)
    if (v > 0) { localStorage.setItem(gKey, v.toString()); setGoal(v) }
    setEditingGoal(false)
  }
  function resetGoal() { localStorage.removeItem(gKey); setGoal(rep.autoGoal); setEditingGoal(false) }

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

      {/* Stats grid */}
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
  const { profile } = useAuth()
  const { statusColor } = useSettings()
  const [deals,           setDeals]           = useState([])
  const [users,           setUsers]           = useState([])
  const [loading,         setLoading]         = useState(true)
  const [tab,             setTab]             = useState('overview')
  const [dateFrom,        setDateFrom]        = useState(getPresetRange('mtd').from)
  const [dateTo,          setDateTo]          = useState(getPresetRange('mtd').to)
  const [activePreset,    setActivePreset]    = useState('mtd')
  const [teamGoalVersion, setTeamGoalVersion] = useState(0)
  const [editingTeamGoal, setEditingTeamGoal] = useState(false)
  const [teamGoalInput,   setTeamGoalInput]   = useState('')

  const tGoalKey = profile?.role === 'manager' ? teamGoalKey(profile.id) : null

  function saveTeamGoal() {
    const v = parseFloat(teamGoalInput)
    if (v > 0 && tGoalKey) { localStorage.setItem(tGoalKey, v.toString()); setTeamGoalVersion(n => n + 1) }
    setEditingTeamGoal(false)
  }
  function resetTeamGoal() {
    if (tGoalKey) localStorage.removeItem(tGoalKey)
    setTeamGoalVersion(n => n + 1); setEditingTeamGoal(false)
  }

  useEffect(() => {
    Promise.all([fetchDeals(), fetchUsers()]).then(([{ data: d }, { data: u }]) => {
      setDeals(d ?? []); setUsers(u ?? []); setLoading(false)
    })
  }, [])

  function handleRangeChange({ from, to, preset }) {
    setDateFrom(from); setDateTo(to); setActivePreset(preset)
  }

  const role = profile?.role

  const visibleReps = useMemo(() => {
    if (!profile) return []
    if (role === 'admin' || role === 'vp') return users.filter(u => u.role === 'rep')
    if (role === 'director') {
      const myMgrIds = new Set(users.filter(u => u.director_id === profile.id).map(u => u.id))
      return users.filter(u => u.role === 'rep' && myMgrIds.has(u.manager_id))
    }
    if (role === 'manager') return users.filter(u => u.role === 'rep' && u.manager_id === profile.id)
    if (role === 'rep') {
      return profile.manager_id
        ? users.filter(u => u.role === 'rep' && u.manager_id === profile.manager_id)
        : users.filter(u => u.id === profile.id)
    }
    return []
  }, [users, profile, role])

  const repStats = useMemo(() => {
    const now    = new Date()
    const curKey = format(now, 'yyyy-MM')
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
      let weekPtr = startOfWeek(now, { weekStartsOn: 1 })
      const thisWs = format(weekPtr,'yyyy-MM-dd'), thisWe = format(endOfWeek(weekPtr,{weekStartsOn:1}),'yyyy-MM-dd')
      if (!allRepDeals.some(d => d.sale_date >= thisWs && d.sale_date <= thisWe)) weekPtr = addDays(weekPtr,-7)
      for (let i=0; i<52; i++) {
        const ws = format(weekPtr,'yyyy-MM-dd'), we = format(endOfWeek(weekPtr,{weekStartsOn:1}),'yyyy-MM-dd')
        if (!allRepDeals.some(d => d.sale_date >= ws && d.sale_date <= we)) break
        streak++; weekPtr = addDays(weekPtr,-7)
      }
      return { ...rep, deals: periodDeals.length, revenue, commission, mtdRev, autoGoal: goal, activePipeline, daysSinceLast, streak }
    })
    rows.sort((a,b) => b.revenue-a.revenue)
    return rows.map((r,i) => ({...r, rank: i+1}))
  }, [visibleReps, deals, dateFrom, dateTo])

  const teamStats = useMemo(() => {
    if (!profile) return []
    return users.filter(u => u.role === 'manager').map(mgr => {
      const teamReps  = users.filter(u => u.role === 'rep' && u.manager_id === mgr.id)
      const repIds    = new Set(teamReps.map(r => r.id))
      const teamDeals = deals.filter(d => {
        const inPeriod = (!dateFrom||(d.sale_date??'')>=dateFrom)&&(!dateTo||(d.sale_date??'')<=dateTo)
        return inPeriod && (repIds.has(d.setter_id)||repIds.has(d.closer_id))
      })
      const revenue    = teamDeals.reduce((s,d) => s+(parseFloat(d.baseline_revenue)||0), 0)
      const commission = teamDeals.reduce((s,d) => {
        const a = calcDealCommissions(d)
        return s + a.setterAmt + a.closerAmt + a.managerAmt + a.directorAmt + a.vpAmt
      }, 0)
      return { id: mgr.id, name: mgr.name, reps: teamReps.length, deals: teamDeals.length, revenue, commission, revenuePerRep: teamReps.length>0?revenue/teamReps.length:0, isMyTeam: role==='manager'&&mgr.id===profile.id }
    }).sort((a,b) => b.revenue-a.revenue)
  }, [users, deals, dateFrom, dateTo, role, profile])

  const maxRevenue = teamStats.reduce((m,t) => Math.max(m,t.revenue), 0)

  const companyRepTiers = useMemo(() => {
    const dayOfMonth  = new Date().getDate()
    if (Math.ceil(dayOfMonth/7) <= 1) return null
    const curKey  = format(new Date(),'yyyy-MM')
    const allReps = users.filter(u => u.role==='rep')
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
    const commission = periodDeals.reduce((s,d) => {
      const a = calcDealCommissions(d)
      return s + a.setterAmt + a.closerAmt + a.managerAmt + a.directorAmt + a.vpAmt
    }, 0)
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
    const savedGoal        = tGoalKey?localStorage.getItem(tGoalKey):null
    const goal             = savedGoal?parseFloat(savedGoal):autoGoal
    const dailyRate        = dayOfMonth>0?mtdRevenue/dayOfMonth:0
    const projectedRevenue = dailyRate*daysInMonth
    const expectedByNow    = goal*(dayOfMonth/daysInMonth)
    const paceVsGoal       = expectedByNow>0?(mtdRevenue/expectedByNow)*100:0
    const pctOfGoal        = Math.min((mtdRevenue/goal)*100,100)
    return { mtdRevenue, projectedRevenue, goal, autoGoal, paceVsGoal, pctOfGoal, dayOfMonth, daysInMonth }
  }, [deals, visibleReps, tGoalKey, teamGoalVersion])

  const recentWins = useMemo(() => {
    const repIds = new Set(visibleReps.map(r=>r.id))
    const now    = new Date()
    return deals
      .filter(d=>(repIds.has(d.setter_id)||repIds.has(d.closer_id))&&d.sale_date&&d.status!=='Sales Issue')
      .sort((a,b)=>(b.sale_date??'').localeCompare(a.sale_date??''))
      .slice(0,8)
      .map(d=>({ ...d, repName: users.find(u=>u.id===(d.closer_id||d.setter_id))?.name??'—', daysAgo: d.sale_date?Math.max(0,Math.floor((now.getTime()-new Date(d.sale_date+'T12:00:00').getTime())/86400000)):0 }))
  }, [deals, visibleReps, users])

  const topPerformer   = repStats[0]
  const canEditNotes   = ['manager','director','vp','admin'].includes(role)

  if (loading) return <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading…</div>

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
        <WeeklyStats deals={deals} reps={visibleReps} users={users} canEdit={canEditNotes} profileId={profile?.id} />
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
                Goal {role==='manager'&&!editingTeamGoal&&(
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

      {/* Rep cards — 1-col mobile, 2-col tablet, 3-col desktop */}
      <div>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-[13px] md:text-[14px] font-bold text-white">Rep Performance</h2>
          <p className="text-[11px] text-white/30 hidden sm:block">Ranked by revenue</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
          {repStats.map(rep => (
            <RepCard key={rep.id} rep={rep}
              healthTier={companyRepTiers?(companyRepTiers[rep.id]??'green'):'green'}
              canEdit={canEditNotes}
              canEditGoal={canEditNotes||profile?.id===rep.id} />
          ))}
          {repStats.length===0&&<p className="col-span-3 py-8 text-center text-white/30 text-[13px]">No reps found for your role.</p>}
        </div>
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
